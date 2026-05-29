import pdfParse from 'pdf-parse';
import { ToolDefinition } from '../../openai-client';
import { checkProcuracaoStatus, markProcuracaoCompleted, checkCnpjSerpro, consultarProcuracaoSerpro, trackResourceDelivery, sendMessageSegment, getUser, updateUser } from '../../server-tools';
import pool from '../../../lib/db';
import redis from '../../../lib/redis';
import { createRegularizacaoMessageSegments, createAutonomoMessageSegments, createAssistidoMessageSegments, createSituacaoFormSegments, MessageSegment } from '../../regularizacao-system';
import { AgentContext } from '../../types';
import { consultarDividaAtivaPorDevedor } from '../../../lib/pgfn';

async function processMessageSegments(phone: string, segments: MessageSegment[], sender: (segment: MessageSegment) => Promise<void>): Promise<void> {
    for (const segment of segments) {
        if (segment.delay && segment.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, segment.delay));
        }
        await sender(segment);
    }
}

const ADMIN_PHONES = (process.env.ADMIN_PHONES ?? '')
    .split(',')
    .map(p => p.trim().replace(/\D/g, ''))
    .filter(Boolean);

async function resolveUserCnpjAndProcuracaoStatus(userData: any, callerPhone?: string): Promise<{
    ok: boolean;
    cnpj?: string;
    message?: string;
}> {
    if (!userData?.id) {
        return { ok: false, message: 'Usuário sem identificação interna. Atualize o cadastro antes da consulta.' };
    }

    const isAdmin = callerPhone
        ? ADMIN_PHONES.some(ap => callerPhone.replace(/\D/g, '').endsWith(ap))
        : false;

    // cnpj_ativo vem do Redis — evita race condition entre sessões paralelas
    const redisCnpjAtivo = await redis.get(`session:cnpj_ativo:${userData.id}`).catch(() => null);

    const resLead = await pool.query('SELECT cnpj FROM leads WHERE id = $1 LIMIT 1', [userData.id]);
    const leadRow = resLead.rows[0] || {};
    const cnpj = (redisCnpjAtivo?.replace(/\D/g, '') || leadRow.cnpj) as string | undefined;

    if (!cnpj) {
        return { ok: false, message: 'CNPJ não localizado. Peça ao cliente para confirmar os dados cadastrais (use update_user com o campo cnpj).' };
    }

    if (isAdmin) return { ok: true, cnpj };

    // Verifica se é empresa principal ou adicional
    const isPrincipal = !redisCnpjAtivo ||
        redisCnpjAtivo.replace(/\D/g, '') === (leadRow.cnpj || '').replace(/\D/g, '');

    let hasFormalProcuracao = false;
    if (isPrincipal) {
        const procRes = await pool.query(
            `SELECT procuracao, procuracao_ativa FROM leads_processo WHERE lead_id = $1 LIMIT 1`,
            [userData.id]
        );
        const row = procRes.rows[0] || {};
        hasFormalProcuracao = Boolean(row.procuracao) || Boolean(row.procuracao_ativa);
    } else {
        const procRes = await pool.query(
            `SELECT procuracao, procuracao_ativa FROM lead_empresa
             WHERE lead_id = $1 AND REGEXP_REPLACE(cnpj,'[^0-9]','','g') = $2 LIMIT 1`,
            [userData.id, cnpj.replace(/\D/g, '')]
        );
        const row = procRes.rows[0] || {};
        hasFormalProcuracao = Boolean(row.procuracao) || Boolean(row.procuracao_ativa);
    }

    const hasTrackedCompletion = await checkProcuracaoStatus(userData.id);

    if (!hasFormalProcuracao && !hasTrackedCompletion) {
        try {
            const serproResult = await consultarProcuracaoSerpro(cnpj);
            const parsed = JSON.parse(serproResult) as Record<string, unknown>;
            const bodyStr = JSON.stringify(parsed).toLowerCase();
            const ausente = bodyStr.includes('procuracao_ausente') ||
                            bodyStr.includes('não encontrad') ||
                            bodyStr.includes('nao encontrad') ||
                            bodyStr.includes('procuracao nao') ||
                            (parsed.ok === false);
            if (!ausente) {
                await markProcuracaoCompleted(userData.id);
                return { ok: true, cnpj };
            }
        } catch {
            // Serpro indisponível — não bloqueia, deixa passar
            return { ok: true, cnpj };
        }
        return {
            ok: false,
            message: `Procuração e-CAC não localizada para o CNPJ ${cnpj}. O cliente precisa cadastrá-la antes da consulta.`,
        };
    }

    return { ok: true, cnpj };
}

/**
 * Busca o CPF do empresário via CCMEI_DADOS.
 * Necessário para serviços CPF-based: SIT_FISCAL_SOLICITAR, SIT_FISCAL_RELATORIO, CND.
 */
async function resolveEmpresarioCpf(cnpj: string): Promise<string | null> {
    try {
        const raw = await checkCnpjSerpro(cnpj, 'CCMEI_DADOS');
        const envelope = JSON.parse(raw) as Record<string, unknown>;
        const dadosRaw = envelope.dados ?? (envelope.primary as Record<string, unknown> | undefined)?.dados;
        if (!dadosRaw || dadosRaw === '') return null;
        const dados = (typeof dadosRaw === 'string' ? JSON.parse(dadosRaw) : dadosRaw) as Record<string, unknown>;
        const empresario = dados.empresario as Record<string, unknown> | undefined;
        const cpf = empresario?.cpf as string | undefined;
        return cpf ? cpf.replace(/\D/g, '') : null;
    } catch {
        return null;
    }
}

/**
 * Extrai protocolo do envelope de resposta de SIT_FISCAL_SOLICITAR.
 * Serpro pode devolver o protocolo em vários campos dependendo da versão.
 */
function extractSitfisProtocolo(envelope: Record<string, unknown>): string | undefined {
    // Tenta direto no envelope raiz
    const top = envelope.protocoloRelatorio ?? envelope.nrProtocolo ?? envelope.protocolo ?? envelope.numProtocolo;
    if (top) return String(top);

    // Tenta dentro de `dados` (JSON string)
    const dadosRaw = envelope.dados;
    if (dadosRaw && typeof dadosRaw === 'string' && dadosRaw !== '') {
        try {
            const d = JSON.parse(dadosRaw) as Record<string, unknown>;
            const nested = d.protocoloRelatorio ?? d.nrProtocolo ?? d.protocolo ?? d.numProtocolo;
            if (nested) return String(nested);
        } catch { /* ignora */ }
    }

    return undefined;
}

const ANOS_RETROATIVOS = 5; // Consulta os últimos 6 anos (atual - 5 até atual)

type AnoConsulta = { ano: number; tem_debitos: boolean | null; detalhe?: string };
type ServicoResult = {
    situacao: 'COM_DEBITO' | 'SEM_DEBITO' | 'INCONCLUSIVO';
    anos_consultados: number[];
    anos_com_debito: number[];
    anos_sem_debito: number[];
    anos_inconclusivos: number[];
};

function formatServicoResult(anoConsultas: AnoConsulta[]): ServicoResult {
    const anos_com_debito = anoConsultas.filter(r => r.tem_debitos === true).map(r => r.ano);
    const anos_sem_debito = anoConsultas.filter(r => r.tem_debitos === false).map(r => r.ano);
    const anos_inconclusivos = anoConsultas.filter(r => r.tem_debitos === null).map(r => r.ano);

    const situacao: ServicoResult['situacao'] =
        anos_com_debito.length > 0 ? 'COM_DEBITO'
        : anos_inconclusivos.length > 0 ? 'INCONCLUSIVO'
        : 'SEM_DEBITO';

    return {
        situacao,
        anos_consultados: anoConsultas.map(r => r.ano),
        anos_com_debito,
        anos_sem_debito,
        anos_inconclusivos,
    };
}

function buildResumoExecutivo(pgmei: ServicoResult, pgfn: ServicoResult, pgfnResumo?: { resumo_texto?: string }): string {
    const linhas: string[] = [];

    if (pgmei.situacao === 'COM_DEBITO') {
        linhas.push(`PGMEI (guias DAS): débitos detectados em ${pgmei.anos_com_debito.join(', ')}`);
    } else if (pgmei.situacao === 'SEM_DEBITO') {
        linhas.push(`PGMEI (guias DAS): situação regular em todos os anos consultados`);
    } else {
        linhas.push(`PGMEI (guias DAS): resultado inconclusivo — verificação adicional necessária`);
    }

    if (pgfn.situacao === 'COM_DEBITO') {
        linhas.push(pgfnResumo?.resumo_texto || `PGFN (Dívida Ativa): inscrição em dívida ativa detectada`);
    } else if (pgfn.situacao === 'SEM_DEBITO') {
        linhas.push(`PGFN (Dívida Ativa): sem débitos inscritos na dívida ativa`);
    } else {
        linhas.push(`PGFN (Dívida Ativa): resultado inconclusivo — verificação adicional necessária`);
    }

    return linhas.join('\n');
}

export const REGULARIZACAO_RULES = `
# Regras de Regularização e Conformidade Serpro
### Fluxo de Regularização (Dívidas, PGMEI, Abertura/Baixa)
Se o cliente mencionar dívidas, pendências, boleto atrasado ou regularização:
1. **NÃO ENVIE O FORMULÁRIO AINDA.**
2. Use a tool 'iniciar_fluxo_regularizacao' para introduzir o processo de forma natural.
3. Aguarde a resposta do cliente (Opção A ou Opção B):
   - **Se Opção A (Procuração e-CAC):** Use 'enviar_processo_autonomo'. Após o cliente confirmar que concluiu, use 'verificar_serpro_pos_ecac' IMEDIATAMENTE.
     - Sucesso → chame 'marcar_procuracao_concluida' e em seguida 'consultar_pgmei_serpro'.
     - Falha → peça print do e-CAC.
   - **Se Opção B (recusou e-CAC / prefere WhatsApp):** Use 'iniciar_coleta_situacao_whatsapp'. Em seguida, colete os dados conversacionalmente na seguinte ordem: CNPJ, Razão Social, CPF do empresário, faturamento mensal, se tem dívidas e quais. Salve cada informação obtida com update_user. Ao concluir (CNPJ + faturamento + tem_divida coletados), acione 'enviar_link_reuniao' proativamente.

### COLETA INTELIGENTE DE DADOS DA EMPRESA E CADASTRO (MANDATÓRIO)
Sempre que um lead entrar no fluxo de Regularização, Contabilidade ou iniciar o processo de Procuração, VOCÊ DEVE OBRIGATORIAMENTE coletar os dados da empresa.
1. Antes de se despedir ou se o cliente estiver travado esperando algo, pergunte natural e gradualmente:
   - "Aproveitando, qual é o seu CNPJ?"
   - "Qual o nome (Razão Social) da sua empresa?"
   - "A empresa está no Simples Nacional ou MEI?"
   - "Vocês já possuem Certificado Digital A1 ativo?"
2. Não vomite todas as perguntas em um único balão gigante. Faça isso de forma conversacional e amigável, misturando com as explicações da Procuração.
3. Isso é crucial porque um sistema invisível irá extrair essas informações do seu chat com o cliente para preencher a ficha cadastral no Integra Contador. Nada de prosseguir assumindo que os dados não importam.


- **MEI Excluído ou Desenquadrado:**
  Ofereça duas opções claras:
  Opção 1 (Procuração): Regularizar agora e aguardar (valor menor, sem Gov).
  Opção 2 (Acesso Direto): Baixar atual e abrir novo (valor maior, exige Gov).

### CONSULTAS SERPRO — REGRAS ESTRITAS E CAMADAS

#### REGRA DE OURO — Use o cache antes de gastar recursos
**SEMPRE** chame 'consultar_dados_cliente' ANTES de qualquer tool Serpro.
A resposta contém o campo 'consultas_serpro' com o histórico por serviço:
- Se **ainda_valido = true** → use o campo 'resultado' diretamente. NÃO chame o Serpro de novo.
- Se **ainda_valido = false** ou o serviço não aparece → chame a tool Serpro correspondente.
- O campo 'regras_frescor' lista por quantos dias cada dado é válido (ex: PGMEI=7d, CCMEI_DADOS=90d, CND=180d).

#### Regras adicionais
- **NÃO FAÇA** nenhuma consulta Serpro sem Procuração confirmada (verificar_procuracao_status ou fluxo explícito).
- **CAMADA 1 (padrão):** Use 'consultar_pgmei_serpro' — retorna PGMEI (débitos DAS) e PGFN (Dívida Ativa). Rápida, focada.
- **CAMADA 2 (somente se necessário e sem cache válido):**
  - 'iniciar_coleta_situacao_whatsapp' → alternativa ao e-CAC: coleta dados do lead pelo chat.
  - 'consultar_ccmei_serpro' → dados cadastrais, situação e CNAE da empresa.
  - 'consultar_divida_ativa_serpro' → dívida ativa por ano específico.
  - 'consultar_situacao_fiscal_serpro' → relatório completo SITFIS (PDF). Mais lento e custoso — use só quando solicitado.
  - 'consultar_cnd_serpro' → Certidão Negativa de Débitos. Requer situação fiscal limpa.
  - 'consultar_caixa_postal_serpro' → mensagens da Receita Federal para o cliente.
- O uso desenfreado de consultas profundas gasta recursos e expõe nossos IPs. Prefira sempre a Camada 1.
- NUNCA use ferramentas/integrações não assinadas ou inativas na Loja Serpro (ex: DASN_SIMEI). Se o usuário pedir algo relacionado a declaração anual (DASN), informe que a integração está desabilitada temporariamente e faça manualmente.
- Explicite ao cliente: "Para consultarmos as pendências do seu MEI com segurança, o primeiro passo é a Procuração e-CAC (Opção A)."

#### INTERPRETAÇÃO DO RESULTADO DE consultar_pgmei_serpro (CRÍTICO)
A tool consulta automaticamente os **últimos 6 anos** (sem precisar pedir). Campos principais:
- \`resumo_executivo\`: diagnóstico em texto — use como base para comunicar ao cliente.
- \`pgmei.situacao\` / \`pgfn.situacao\`: \`COM_DEBITO\` | \`SEM_DEBITO\` | \`INCONCLUSIVO\`
- \`pgmei.anos_com_debito\` / \`pgfn.anos_com_debito\`: lista de anos com débitos detectados
- \`aviso\` (se presente): instrução adicional — leia e siga.

**Regras de ouro:**
- \`COM_DEBITO\` → HÁ DÍVIDAS. Informe ao cliente os anos listados em \`anos_com_debito\`.
- \`SEM_DEBITO\` → situação regular em todos os anos consultados. Pode confirmar ao cliente.
- \`INCONCLUSIVO\` → NÃO diga "sem dívidas". Diga "não consegui confirmar" e sugira verificação ou reunião.
- Use \`resumo_executivo\` como base, adaptando para linguagem simples e amigável.
- Nunca exiba os campos brutos JSON ao cliente — traduza tudo para português claro.

#### GATE is_mei — Obrigatório antes da Camada 1
ANTES de chamar 'consultar_pgmei_serpro':
- Se is_mei = true (ou indefinido) → prossiga normalmente com Camada 1.
- Se is_mei = false → NÃO chame PGMEI. Use 'consultar_situacao_fiscal_serpro' (SITFIS) pois o cliente é Simples Nacional ou outro regime, e PGMEI só funciona para MEI.
- Se não souber → chame 'consultar_ccmei_serpro' primeiro para confirmar enquadramento.

#### APÓS RESULTADO SERPRO — Atualização Obrigatória no Banco
Imediatamente após comunicar o resultado ao cliente, salve com update_user:
- update_user(situacao_fiscal='COM_DEBITO' | 'SEM_DEBITO' | 'INCONCLUSIVO')
- Se COM_DEBITO: update_user(tem_divida=true, situacao='negociacao')
- Se SEM_DEBITO: update_user(tem_divida=false)
- Sempre: update_user(observacoes='SERPRO [data]: PGMEI=[situacao], PGFN=[situacao], anos=[lista]')

#### TEMPLATE WHATSAPP — Resultado Serpro (use sempre, nunca JSON bruto)

COM_DEBITO:
"Consultei o CNPJ [cnpj] aqui no Serpro e encontrei:|||⚠️ *PGMEI (guias DAS):* débitos nos anos [lista_anos] — guias em aberto|||⚠️ *PGFN (Dívida Ativa):* [COM_DEBITO: pendência nos anos [lista] | SEM_DEBITO: sem inscrição em dívida ativa]|||Para regularizar, o caminho mais rápido é [próximo passo concreto]. Quer que eu explique como funciona?"

SEM_DEBITO:
"Boa notícia! Consultei o CNPJ [cnpj] no Serpro:|||✅ *PGMEI (guias DAS):* em dia — nenhuma pendência encontrada|||✅ *PGFN (Dívida Ativa):* sem inscrições em dívida ativa|||Tudo certo! Quer que eu emita a CND (Certidão Negativa) como comprovante?"

INCONCLUSIVO:
"Consultei o CNPJ [cnpj], mas o resultado veio inconclusivo:|||⚠️ Não consegui confirmar a situação com precisão — isso pode indicar documentos pendentes ou resposta parcial da Receita|||Recomendo uma reunião rápida para analisarmos juntos. Quer agendar?"

REGRAS DE OURO DO TEMPLATE:
- NUNCA diga "sem dívidas" se pgmei.situacao OU pgfn.situacao for INCONCLUSIVO
- Sempre use '|||' para separar cada bloco de informação
- Substitua [cnpj] pelo CNPJ real — nunca exiba o campo bruto
- Termine com trial close (pergunta ou ação concreta)
`;

/**
 * Tenta extrair texto de um PDF em base64 usando pdf-parse.
 * Retorna o texto extraído ou null em caso de falha.
 */
async function extractPdfText(base64: string): Promise<string | null> {
    try {
        const buffer = Buffer.from(base64, 'base64');
        const result = await pdfParse(buffer);
        return result.text?.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Detecta débitos a partir do texto extraído de um PDF da Serpro.
 * Retorna true se houver indicadores de dívida, false se regularizado, null se inconclusivo.
 */
function detectarDebitosNoPdf(texto: string): { tem_debitos: boolean | null; resumo_pdf: string } {
    const t = texto.toUpperCase();

    const INDICADORES_DEBITO = [
        'DEVEDOR', 'IRREGULAR', 'PENDENTE', 'INADIMPLENTE',
        'EM ABERTO', 'VENCIDO', 'DÍVIDA ATIVA', 'DIVIDA ATIVA',
        'GUIA EM ABERTO', 'DAS EM ABERTO', 'PARCELA EM ABERTO',
        'VALOR DEVIDO', 'TOTAL DEVIDO', 'DEBITO'
    ];
    const INDICADORES_REGULAR = [
        'SEM DÉBITO', 'SEM DEBITO', 'SEM PENDÊNCIA', 'SEM PENDENCIA',
        'REGULARIZADO', 'ADIMPLENTE', 'SITUAÇÃO REGULAR', 'SITUACAO REGULAR',
        'NÃO POSSUI DÉBITO', 'NAO POSSUI DEBITO',
    ];

    if (INDICADORES_REGULAR.some(i => t.includes(i))) {
        const resumo_pdf = texto.slice(0, 2500).replace(/\s+/g, ' ').trim();
        return { tem_debitos: false, resumo_pdf };
    }
    
    // Testa débito apenas se não encontrou indicador explícito de regularidade
    // (evita que 'SEM DEBITO' dispare 'DEBITO')
    if (INDICADORES_DEBITO.some(i => t.includes(i)) || t.includes('DÉBITO')) {
        const resumo_pdf = texto.slice(0, 2500).replace(/\s+/g, ' ').trim();
        return { tem_debitos: true, resumo_pdf };
    }
    const resumo_pdf = texto.slice(0, 2500).replace(/\s+/g, ' ').trim();
    return { tem_debitos: null, resumo_pdf };
}

/**
 * Parseia o envelope bruto do Serpro para extrair dados estruturados.
 *
 * O campo `dados` pode ser:
 *  - String JSON (normal) → parseado e retornado como objeto
 *  - String base64 de PDF → texto extraído via pdf-parse e analisado
 *  - Objeto já parseado → usado diretamente
 *  - Vazio → sem dados
 *
 * Retorna `tem_debitos_detectado` para evitar falsos negativos na IA.
 */
export async function parseSerproData(envelope: unknown): Promise<{
    tem_debitos_detectado: boolean | null;
    dados: Record<string, unknown> | null;
    tem_documento_binario: boolean;
    texto_pdf: string | null;
    mensagens_serpro: string[];
}> {
    const NOT_FOUND = { tem_debitos_detectado: null, dados: null, tem_documento_binario: false, texto_pdf: null, mensagens_serpro: [] };
    if (!envelope || typeof envelope !== 'object') return NOT_FOUND;

    const env = envelope as Record<string, unknown>;
    const mensagensRaw = (Array.isArray(env.mensagens) ? env.mensagens : []) as Array<{ codigo?: string; texto?: string }>;
    const mensagens_serpro = mensagensRaw.map(m => `[${m.codigo ?? '?'}] ${m.texto ?? ''}`).filter(Boolean);

    let dados: Record<string, unknown> | null = null;
    let tem_documento_binario = false;
    let texto_pdf: string | null = null;

    const dadosRaw = env.dados;

    // ── Array de itens (PGFN_CONSULTAR / DIVIDA_ATIVA retornam array de débitos) ──
    if (Array.isArray(dadosRaw)) {
        if (dadosRaw.length > 0) {
            const DEBITO_STATUS  = ['ENVIADO A PFN', 'DEVEDOR', 'INADIMPLENTE', 'PENDENTE', 'IRREGULAR', 'DEBITO'];
            const REGULAR_STATUS = ['ADIMPLENTE', 'REGULAR', 'SEM_DEBITO', 'SEM DEBITO'];
            let temDebito = false, temRegular = false;
            for (const item of dadosRaw as Array<Record<string, unknown>>) {
                const s = String(item.situacaoDebito ?? item.situacao ?? '').toUpperCase().trim();
                if (DEBITO_STATUS.some(d => s.includes(d)))  { temDebito  = true; break; }
                if (REGULAR_STATUS.some(d => s.includes(d))) { temRegular = true; }
            }
            return {
                tem_debitos_detectado: temDebito ? true : (temRegular ? false : null),
                dados: null, tem_documento_binario: false, texto_pdf: null, mensagens_serpro,
            };
        }
        // Array vazio → sinal definitivo vem das mensagens (ex: código 25001 = sem débitos)
        const msTexto = mensagensRaw.map(m => `${m.codigo ?? ''} ${m.texto ?? ''}`).join(' ')
            .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
        const comDebito = ['ENVIADO A PFN', 'EM DEBITO', 'DEVEDOR', 'INADIMPLENTE'].some(s => msTexto.includes(s));
        const semDebito = ['NAO HA DEBITOS', 'SEM DEBITO', '25001', 'SITUACAO REGULAR', 'NADA CONSTA'].some(s => msTexto.includes(s));
        return {
            tem_debitos_detectado: comDebito ? true : (semDebito ? false : null),
            dados: null, tem_documento_binario: false, texto_pdf: null, mensagens_serpro,
        };
    }

    if (typeof dadosRaw === 'string' && dadosRaw.length > 0) {
        try {
            const parsed = JSON.parse(dadosRaw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                dados = parsed as Record<string, unknown>;
            }
        } catch {
            // dados não é JSON válido → tenta extrair como PDF base64
            tem_documento_binario = true;
            texto_pdf = await extractPdfText(dadosRaw);
        }
    } else if (dadosRaw && typeof dadosRaw === 'object' && !Array.isArray(dadosRaw)) {
        dados = dadosRaw as Record<string, unknown>;
    }

    // Se dados contém um campo 'pdf' ou 'documento' em base64, extrai o texto
    if (dados && !texto_pdf) {
        const pdfBase64 = typeof dados.pdf === 'string' ? dados.pdf 
            : typeof dados.documento === 'string' ? dados.documento 
            : null;
            
        if (pdfBase64 && pdfBase64.length > 100) {
            tem_documento_binario = true;
            texto_pdf = await extractPdfText(pdfBase64);
        }
    }

    // documentos no topo do envelope também podem conter PDFs
    const documentos = Array.isArray(env.documentos) ? env.documentos : [];
    for (const doc of documentos as Array<Record<string, unknown>>) {
        if (typeof doc.conteudo === 'string' && doc.conteudo.length > 0 && !texto_pdf) {
            tem_documento_binario = true;
            texto_pdf = await extractPdfText(doc.conteudo);
            if (texto_pdf) break;
        }
    }

    // Se extraiu texto do PDF, analisa para detectar débitos
    if (tem_documento_binario && texto_pdf) {
        const { tem_debitos, resumo_pdf } = detectarDebitosNoPdf(texto_pdf);
        return {
            tem_debitos_detectado: tem_debitos,
            dados: null,
            tem_documento_binario: true,
            texto_pdf: resumo_pdf,
            mensagens_serpro,
        };
    }

    // Documento sem texto legível (PDF escaneado ou erro de extração)
    if (tem_documento_binario) {
        return { tem_debitos_detectado: null, dados: null, tem_documento_binario: true, texto_pdf: null, mensagens_serpro };
    }

    if (!dados) {
        // Sem dados estruturados — tenta mensagens como último sinal
        const msTexto = mensagensRaw.map(m => `${m.codigo ?? ''} ${m.texto ?? ''}`).join(' ')
            .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
        const comDebito = ['ENVIADO A PFN', 'EM DEBITO', 'DEVEDOR', 'INADIMPLENTE'].some(s => msTexto.includes(s));
        const semDebito = ['NAO HA DEBITOS', 'SEM DEBITO', '25001', 'SITUACAO REGULAR', 'NADA CONSTA'].some(s => msTexto.includes(s));
        return {
            tem_debitos_detectado: comDebito ? true : (semDebito ? false : null),
            dados: null, tem_documento_binario: false, texto_pdf: null, mensagens_serpro,
        };
    }

    // Detectar débitos a partir dos campos JSON conhecidos
    const situacao = String(
        dados.situacaoContribuinte ?? dados.situacao ?? dados.statusContribuinte ?? ''
    ).toUpperCase();

    const guiasRaw = dados.guiasEmAberto ?? dados.debitos ?? dados.debitosPGMEI ?? dados.debitosTotal ?? dados.guias ?? dados.das ?? dados.parcelas ?? dados.itens ?? dados.lista ?? null;
    const hasGuias = Array.isArray(guiasRaw) ? guiasRaw.length > 0
        : typeof guiasRaw === 'number' ? guiasRaw > 0
        : false;

    const INDICADORES_DEBITO = ['DEVEDOR', 'IRREGULAR', 'PENDENTE', 'INADIMPLENTE', 'DEBITO'];
    const INDICADORES_REGULAR = ['SEM_DEBITO', 'REGULAR', 'ADIMPLENTE', 'SEM DEBITO', 'SEM DÉBITO'];

    const tem_debitos_detectado =
        INDICADORES_DEBITO.some(i => situacao.includes(i)) || hasGuias ? true
        : INDICADORES_REGULAR.some(i => situacao.includes(i)) ? false
        : null;

    return { tem_debitos_detectado, dados, tem_documento_binario: false, texto_pdf: null, mensagens_serpro };
}

export const getRegularizacaoTools = (context: AgentContext): ToolDefinition[] => [
    // ── Camada 1 ────────────────────────────────────────────────────────────────
    {
        name: 'consultar_pgmei_serpro',
        description: 'Camada 1: busca débitos PGMEI (DAS MEI) e Dívida Ativa PGFN nos últimos 6 anos automaticamente. Primeira consulta após Procuração confirmada.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p, context.userPhone);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }

                const currentYear = new Date().getFullYear();
                  const anos = Array.from({ length: ANOS_RETROATIVOS + 1 }, (_, i) => currentYear - ANOS_RETROATIVOS + i);

                  const [pgmeiRawAll, pgfnRaw, dasnRaw] = await Promise.all([
                      Promise.allSettled(anos.map(ano => checkCnpjSerpro(gate.cnpj!, 'PGMEI', { ano: String(ano) }))),
                      Promise.resolve(consultarDividaAtivaPorDevedor(gate.cnpj!)).then(
                          result => ({ status: 'fulfilled' as const, value: result }),
                          reason => ({ status: 'rejected' as const, reason })
                      ),
                      // Tenta consultar DASN_SIMEI, mas não quebra se der 403 (não assinada)
                      Promise.resolve(checkCnpjSerpro(gate.cnpj!, 'DASN_SIMEI', { ano: String(currentYear - 1) })).then(
                          result => ({ status: 'fulfilled' as const, value: result }),
                          reason => ({ status: 'rejected' as const, reason })
                      )
                  ]);

                const parseAnoResults = async (rawAll: PromiseSettledResult<string>[]): Promise<AnoConsulta[]> =>
                    Promise.all(rawAll.map(async (result, i) => {
                        const ano = anos[i];
                        if (result.status === 'rejected') return { ano, tem_debitos: null };
                        try {
                            const envelope = JSON.parse(result.value);
                            const parsed = await parseSerproData(envelope);
                            return {
                                ano,
                                tem_debitos: parsed.tem_debitos_detectado,
                                detalhe: parsed.texto_pdf ? parsed.texto_pdf.slice(0, 200) : undefined,
                            };
                        } catch {
                            return { ano, tem_debitos: null };
                        }
                    }));

                const pgmeiPorAno = await parseAnoResults(pgmeiRawAll);
                const pgfnPorAno: AnoConsulta[] = pgfnRaw.status === 'fulfilled'
                    ? [{
                        ano: currentYear,
                        tem_debitos: pgfnRaw.value.tem_debitos_detectado,
                        detalhe: pgfnRaw.value.mensagens_pgfn.join(' | ') || undefined,
                    }]
                    : [{ ano: currentYear, tem_debitos: null, detalhe: String(pgfnRaw.reason) }];

                const pgmei = formatServicoResult(pgmeiPorAno);
                const pgfn  = formatServicoResult(pgfnPorAno);
                const pgfn_detalhes = pgfnRaw.status === 'fulfilled' ? pgfnRaw.value.resumo : undefined;
                
                let dasn_info = 'Não verificado';
                if (dasnRaw.status === 'fulfilled') {
                    const dasnParsed = JSON.parse(dasnRaw.value);
                    if (dasnParsed.status === 'error' || dasnParsed.error) {
                        dasn_info = 'DASN-SIMEI não assinada ou indisponível.';
                    } else {
                        dasn_info = 'DASN-SIMEI consultada com sucesso. Verifique os dados brutos.';
                    }
                }

                const resumo_executivo = buildResumoExecutivo(pgmei, pgfn, pgfn_detalhes);

                const aviso =
                    pgmei.situacao === 'COM_DEBITO' || pgfn.situacao === 'COM_DEBITO'
                        ? '⚠️ Débitos encontrados. Informe ao cliente os anos com pendências e oriente a regularização.'
                        : pgmei.situacao === 'INCONCLUSIVO' || pgfn.situacao === 'INCONCLUSIVO'
                        ? '⚠️ Resultado inconclusivo em alguns anos. Não afirme "sem dívidas" sem verificação adicional.'
                        : undefined;

                // Atualiza a ficha do lead com os dados reais encontrados
                const tem_divida = pgmei.situacao === 'COM_DEBITO' || pgfn.situacao === 'COM_DEBITO';
                let tipo_divida = '';
                if (pgmei.situacao === 'COM_DEBITO' && pgfn.situacao === 'COM_DEBITO') tipo_divida = 'Federal e DAS';
                else if (pgfn.situacao === 'COM_DEBITO') tipo_divida = 'Federal';
                else if (pgmei.situacao === 'COM_DEBITO') tipo_divida = 'DAS';

                const valor_divida_pgfn = pgfn_detalhes?.valor_total_consolidado || 0;

                updateUser({
                    telefone: context.userPhone,
                    tem_divida,
                    tipo_divida: tipo_divida || undefined,
                    valor_divida_pgfn
                }).catch(err => console.error('[consultar_pgmei_serpro] Erro ao atualizar lead:', err));

                return JSON.stringify({ status: 'success', resumo_executivo, pgmei, pgfn, pgfn_detalhes, dasn_info, aviso });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },

    // ── Fluxo de procuração ──────────────────────────────────────────────────────
    {
        name: 'iniciar_fluxo_regularizacao',
        description: 'Inicia o fluxo de regularização fiscal aprimorado.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const segments = createRegularizacaoMessageSegments();
                await processMessageSegments(context.userPhone, segments, (s) => sendMessageSegment(context.userPhone, s));
                return JSON.stringify({ status: 'success', message: 'Fluxo de regularização iniciado' });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    {
        name: 'enviar_processo_autonomo',
        description: 'Envia o processo autônomo de procuração e-CAC regularização.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                let leadId: number | null = null;
                if (ud) {
                    const p = JSON.parse(ud);
                    if (p.status !== 'error' && p.status !== 'not_found') leadId = p.id;
                }
                const segments = createAutonomoMessageSegments();
                await processMessageSegments(context.userPhone, segments, (s) => sendMessageSegment(context.userPhone, s));
                if (leadId) {
                    await trackResourceDelivery(leadId, 'link-ecac', 'https://cav.receita.fazenda.gov.br/autenticacao/login');
                    await trackResourceDelivery(leadId, 'video-tutorial', 'video-tutorial-procuracao-ecac');
                }
                return JSON.stringify({ status: 'success' });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    {
        name: 'verificar_procuracao_status',
        description: 'Verifica se o cliente já concluiu a procuração.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const completed = await checkProcuracaoStatus(p.id);
                return JSON.stringify({ status: 'success', completed, message: completed ? 'Procuração já concluída' : 'Procuração pendente' });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    {
        name: 'marcar_procuracao_concluida',
        description: 'Marca a procuração como concluída.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                await markProcuracaoCompleted(p.id);
                return JSON.stringify({ status: 'success' });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    {
        name: 'verificar_serpro_pos_ecac',
        description: 'Verifica no Serpro se a procuração do cliente foi registrada no e-CAC.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });

                if (!p.id) return JSON.stringify({ status: 'error', message: 'Usuário sem ID interno. Atualize o cadastro.' });
                const redisCnpjAtivo = await redis.get(`session:cnpj_ativo:${p.id}`).catch(() => null);
                const resLead = await pool.query(
                    'SELECT cnpj FROM leads WHERE id = $1 LIMIT 1',
                    [p.id]
                );
                const leadRow = resLead.rows[0] || {};
                const cnpj = (redisCnpjAtivo?.replace(/\D/g, '') || leadRow.cnpj) as string | undefined;
                if (!cnpj) return JSON.stringify({ status: 'error', message: 'CNPJ não cadastrado. Peça o print.' });

                const serproResult = await consultarProcuracaoSerpro(cnpj);
                const parsed = JSON.parse(serproResult) as Record<string, unknown>;

                if (parsed.status === 'error') {
                    if (parsed.error_type === 'procuracao_ausente') {
                        return JSON.stringify({ status: 'error', message: 'Procuração não detectada no Serpro. O cliente pode ter esquecido de assinar ou salvar.' });
                    }
                    return JSON.stringify({ status: 'error', message: `Erro Serpro: ${parsed.message}` });
                }

                // Sincroniza imediatamente no banco para refletir na lista sem depender
                // de chamada adicional de ferramenta.
                await markProcuracaoCompleted(p.id);

                return JSON.stringify({
                    status: 'success',
                    message: 'Procuração validada com sucesso via Serpro e sincronizada no cadastro.',
                    procuracao_ativa: true,
                    serpro_dados: parsed,
                });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },

    // ── Opção B: coleta in-chat ──────────────────────────────────────────────────
    {
        name: 'iniciar_coleta_situacao_whatsapp',
        description: 'Inicia coleta conversacional de dados do lead pelo WhatsApp quando o cliente recusa a Opção A (e-CAC). Envia mensagem de boas-vindas e instrui o agente a coletar CNPJ, Razão Social, faturamento e dívidas via update_user. Ao concluir a coleta, acione enviar_link_reuniao.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                let leadId: number | null = null;
                if (ud) {
                    const p = JSON.parse(ud);
                    if (p.status !== 'error' && p.status !== 'not_found') leadId = p.id;
                }
                // Removido o envio de formulário web (createSituacaoFormSegments)
                // Agora o Apolo apenas recebe a instrução para iniciar a coleta conversacional
                if (leadId) await trackResourceDelivery(leadId, 'situacao-form-whatsapp', 'started');
                return JSON.stringify({
                    status: 'success',
                    next_steps: 'Faça perguntas conversacionais para coletar: CNPJ, Razão Social, CPF empresário, faturamento_mensal, tem_divida, detalhes dívidas. Salve cada resposta com update_user. Ao concluir CNPJ + faturamento + tem_divida, acione enviar_link_reuniao.'
                });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },

    // ── Camada 2 ────────────────────────────────────────────────────────────────
    {
        name: 'consultar_ccmei_serpro',
        description: 'Consulta dados cadastrais completos do MEI: nome empresarial, situação, CNAE, endereço, enquadramento SIMEI.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p, context.userPhone);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }

                const raw = await checkCnpjSerpro(gate.cnpj, 'CCMEI_DADOS');
                const envelope = JSON.parse(raw) as Record<string, unknown>;
                const dadosRaw = envelope.dados ?? (envelope.primary as Record<string, unknown> | undefined)?.dados;
                const mensagens = (envelope.mensagens ?? (envelope.primary as Record<string, unknown> | undefined)?.mensagens) as Array<{ codigo: string; texto: string }> | undefined;

                if (!dadosRaw || dadosRaw === '') {
                    const msg = mensagens?.[0]?.texto ?? 'Sem dados cadastrais disponíveis.';
                    return JSON.stringify({ status: 'aviso', message: msg });
                }

                const dados = (typeof dadosRaw === 'string' ? JSON.parse(dadosRaw) : dadosRaw) as Record<string, unknown>;
                return JSON.stringify({ status: 'success', dados });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    {
        name: 'consultar_divida_ativa_serpro',
        description: 'Consulta débitos em Dívida Ativa da União pela API PGFN avulsa (token próprio). Use somente após Procuração confirmada.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p, context.userPhone);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }

                const pgfn = await consultarDividaAtivaPorDevedor(gate.cnpj);
                return JSON.stringify({
                    status: 'success',
                    origem: pgfn.origem,
                    consulta: pgfn.consulta,
                    parametro: pgfn.parametro,
                    tem_debitos_detectado: pgfn.tem_debitos_detectado,
                    resumo: pgfn.resumo,
                    dados: pgfn.dados,
                    mensagens_pgfn: pgfn.mensagens_pgfn,
                });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    {
        name: 'consultar_situacao_fiscal_serpro',
        description: 'Solicita relatório completo de Situação Fiscal (SITFIS) via Serpro. Fluxo 2 etapas: solicita protocolo, depois emite relatório. Mais lento — use só quando necessário.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p, context.userPhone);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }

                // SITFIS é CPF-based — obtém CPF do empresário via CCMEI_DADOS
                const cpf = await resolveEmpresarioCpf(gate.cnpj);
                if (!cpf) {
                    return JSON.stringify({ status: 'error', message: 'Não foi possível obter o CPF do empresário para a consulta SITFIS. Verifique os dados cadastrais.' });
                }

                // Passo 1: solicitar protocolo
                const solicitacaoRaw = await checkCnpjSerpro(gate.cnpj, 'SIT_FISCAL_SOLICITAR', { cpf });
                const solicitacao = JSON.parse(solicitacaoRaw) as Record<string, unknown>;
                if (solicitacao.status === 'error') return solicitacaoRaw;

                const protocolo = extractSitfisProtocolo(solicitacao);
                if (!protocolo) {
                    return JSON.stringify({ status: 'error', message: 'Protocolo SITFIS não retornado. Tente novamente em instantes.' });
                }

                // Aguarda processamento do Serpro
                await new Promise(r => setTimeout(r, 4000));

                // Passo 2: emitir relatório
                const resultado = await checkCnpjSerpro(gate.cnpj, 'SIT_FISCAL_RELATORIO', { cpf, protocoloRelatorio: protocolo });
                return resultado;
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    {
        name: 'consultar_cnd_serpro',
        description: 'Emite Certidão Negativa de Débitos via Serpro. Requer situação fiscal regularizada. Usa o mesmo protocolo do SITFIS.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p, context.userPhone);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }

                // CND também é CPF-based (usa mesmo fluxo SITFIS)
                const cpf = await resolveEmpresarioCpf(gate.cnpj);
                if (!cpf) {
                    return JSON.stringify({ status: 'error', message: 'Não foi possível obter o CPF do empresário para emissão da CND.' });
                }

                // Passo 1: solicitar protocolo SITFIS
                const solicitacaoRaw = await checkCnpjSerpro(gate.cnpj, 'SIT_FISCAL_SOLICITAR', { cpf });
                const solicitacao = JSON.parse(solicitacaoRaw) as Record<string, unknown>;
                if (solicitacao.status === 'error') return solicitacaoRaw;

                const protocolo = extractSitfisProtocolo(solicitacao);
                if (!protocolo) {
                    return JSON.stringify({ status: 'error', message: 'Protocolo SITFIS não obtido. CND não pôde ser emitida.' });
                }

                await new Promise(r => setTimeout(r, 4000));

                // Passo 2: emitir CND
                const resultado = await checkCnpjSerpro(gate.cnpj, 'CND', { cpf, protocoloRelatorio: protocolo });
                return resultado;
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    {
        name: 'consultar_caixa_postal_serpro',
        description: 'Consulta mensagens da Caixa Postal Eletrônica da Receita Federal para a empresa do cliente.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p, context.userPhone);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }

                const raw = await checkCnpjSerpro(gate.cnpj, 'CAIXA_POSTAL');
                const envelope = JSON.parse(raw) as Record<string, unknown>;
                const dadosRaw = envelope.dados;
                const mensagens = envelope.mensagens as Array<{ codigo: string; texto: string }> | undefined;

                if (!dadosRaw || dadosRaw === '' || dadosRaw === '[]') {
                    const msg = mensagens?.[0]?.texto ?? 'Nenhuma mensagem na Caixa Postal.';
                    return JSON.stringify({ status: 'success', mensagens: [], message: msg });
                }

                const dados = (typeof dadosRaw === 'string' ? JSON.parse(dadosRaw) : dadosRaw);
                return JSON.stringify({ status: 'success', dados });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
];
