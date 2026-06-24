"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegularizacaoTools = exports.REGULARIZACAO_RULES = void 0;
exports.parseSerproData = parseSerproData;
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const server_tools_1 = require("../../server-tools");
const db_1 = __importDefault(require("../../../lib/db"));
const redis_1 = __importDefault(require("../../../lib/redis"));
const regularizacao_system_1 = require("../../regularizacao-system");
const pgfn_1 = require("../../../lib/pgfn");
const closing_audit_1 = require("./closing-audit");
async function processMessageSegments(phone, segments, sender) {
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
async function resolveUserCnpjAndProcuracaoStatus(userData, callerPhone) {
    if (!userData?.id) {
        return { ok: false, message: 'Usuário sem identificação interna. Atualize o cadastro antes da consulta.' };
    }
    const isAdmin = callerPhone
        ? ADMIN_PHONES.some(ap => callerPhone.replace(/\D/g, '').endsWith(ap))
        : false;
    // cnpj_ativo vem do Redis — evita race condition entre sessões paralelas
    const redisCnpjAtivo = await redis_1.default.get(`session:cnpj_ativo:${userData.id}`).catch(() => null);
    const resLead = await db_1.default.query('SELECT cnpj FROM leads WHERE id = $1 LIMIT 1', [userData.id]);
    const leadRow = resLead.rows[0] || {};
    const cnpj = (redisCnpjAtivo?.replace(/\D/g, '') || leadRow.cnpj);
    if (!cnpj) {
        return { ok: false, message: 'CNPJ não localizado. Peça ao cliente para confirmar os dados cadastrais (use update_user com o campo cnpj).' };
    }
    if (isAdmin)
        return { ok: true, cnpj, bypass_reason: 'admin' };
    // Verifica se é empresa principal ou adicional
    const isPrincipal = !redisCnpjAtivo ||
        redisCnpjAtivo.replace(/\D/g, '') === (leadRow.cnpj || '').replace(/\D/g, '');
    let hasFormalProcuracao = false;
    if (isPrincipal) {
        const procRes = await db_1.default.query(`SELECT procuracao, procuracao_ativa FROM leads_processo WHERE lead_id = $1 LIMIT 1`, [userData.id]);
        const row = procRes.rows[0] || {};
        hasFormalProcuracao = Boolean(row.procuracao) || Boolean(row.procuracao_ativa);
    }
    else {
        const procRes = await db_1.default.query(`SELECT procuracao, procuracao_ativa FROM lead_empresa
             WHERE lead_id = $1 AND REGEXP_REPLACE(cnpj,'[^0-9]','','g') = $2 LIMIT 1`, [userData.id, cnpj.replace(/\D/g, '')]);
        const row = procRes.rows[0] || {};
        hasFormalProcuracao = Boolean(row.procuracao) || Boolean(row.procuracao_ativa);
    }
    const hasTrackedCompletion = await (0, server_tools_1.checkProcuracaoStatus)(userData.id);
    if (!hasFormalProcuracao && !hasTrackedCompletion) {
        try {
            const serproResult = await (0, server_tools_1.consultarProcuracaoSerpro)(cnpj);
            const parsed = JSON.parse(serproResult);
            const bodyStr = JSON.stringify(parsed).toLowerCase();
            const ausente = bodyStr.includes('procuracao_ausente') ||
                bodyStr.includes('não encontrad') ||
                bodyStr.includes('nao encontrad') ||
                bodyStr.includes('procuracao nao') ||
                (parsed.ok === false);
            if (!ausente) {
                await (0, server_tools_1.markProcuracaoCompleted)(userData.id);
                return { ok: true, cnpj };
            }
        }
        catch {
            // Serpro indisponível — não bloqueia, deixa passar
            return { ok: true, cnpj, bypass_reason: 'serpro_down' };
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
async function resolveEmpresarioCpf(cnpj) {
    try {
        const raw = await (0, server_tools_1.checkCnpjSerpro)(cnpj, 'CCMEI_DADOS');
        const envelope = JSON.parse(raw);
        const dadosRaw = envelope.dados ?? envelope.primary?.dados;
        if (!dadosRaw || dadosRaw === '')
            return null;
        const dados = (typeof dadosRaw === 'string' ? JSON.parse(dadosRaw) : dadosRaw);
        const empresario = dados.empresario;
        const cpf = empresario?.cpf;
        return cpf ? cpf.replace(/\D/g, '') : null;
    }
    catch {
        return null;
    }
}
/**
 * Extrai protocolo do envelope de resposta de SIT_FISCAL_SOLICITAR.
 * Serpro pode devolver o protocolo em vários campos dependendo da versão.
 */
function extractSitfisProtocolo(envelope) {
    // Tenta direto no envelope raiz
    const top = envelope.protocoloRelatorio ?? envelope.nrProtocolo ?? envelope.protocolo ?? envelope.numProtocolo;
    if (top)
        return String(top);
    // Tenta dentro de `dados` (JSON string)
    const dadosRaw = envelope.dados;
    if (dadosRaw && typeof dadosRaw === 'string' && dadosRaw !== '') {
        try {
            const d = JSON.parse(dadosRaw);
            const nested = d.protocoloRelatorio ?? d.nrProtocolo ?? d.protocolo ?? d.numProtocolo;
            if (nested)
                return String(nested);
        }
        catch { /* ignora */ }
    }
    return undefined;
}
const ANOS_RETROATIVOS = 5; // Consulta os últimos 6 anos (atual - 5 até atual)
function formatServicoResult(anoConsultas) {
    const anos_com_debito = anoConsultas.filter(r => r.tem_debitos === true).map(r => r.ano);
    const anos_sem_debito = anoConsultas.filter(r => r.tem_debitos === false).map(r => r.ano);
    const anos_inconclusivos = anoConsultas.filter(r => r.tem_debitos === null).map(r => r.ano);
    const situacao = anos_com_debito.length > 0 ? 'COM_DEBITO'
        : anos_inconclusivos.length > 0 ? 'INCONCLUSIVO'
            : 'SEM_DEBITO';
    const detalhes = anoConsultas.filter(a => a.detalhe).map(a => `${a.ano}: ${a.detalhe}`).join(' | ');
    return {
        situacao,
        anos_consultados: anoConsultas.map(r => r.ano),
        anos_com_debito,
        anos_sem_debito,
        anos_inconclusivos,
        detalhes: detalhes || undefined,
    };
}
function buildResumoExecutivo(pgmei, pgfn, pgfnResumo) {
    const linhas = [];
    if (pgmei.situacao === 'COM_DEBITO') {
        linhas.push(`PGMEI (guias DAS): débitos detectados em ${pgmei.anos_com_debito.join(', ')}`);
        if (pgmei.detalhes)
            linhas.push(`  Detalhes PGMEI: ${pgmei.detalhes}`);
    }
    else if (pgmei.situacao === 'SEM_DEBITO') {
        linhas.push(`PGMEI (guias DAS): situação regular em todos os anos consultados`);
    }
    else {
        linhas.push(`PGMEI (guias DAS): resultado inconclusivo — verificação adicional necessária`);
    }
    if (pgfn.situacao === 'COM_DEBITO') {
        linhas.push(pgfnResumo?.resumo_texto || `PGFN (Dívida Ativa): inscrição em dívida ativa detectada`);
    }
    else if (pgfn.situacao === 'SEM_DEBITO') {
        linhas.push(`PGFN (Dívida Ativa): sem débitos inscritos na dívida ativa`);
    }
    else {
        linhas.push(`PGFN (Dívida Ativa): resultado inconclusivo — verificação adicional necessária`);
    }
    return linhas.join('\n');
}
exports.REGULARIZACAO_RULES = `
# Regras de Regularização e Conformidade Serpro
### Fluxo de Regularização (Dívidas, PGMEI, Abertura/Baixa)
Se o cliente mencionar dívidas, pendências, boleto atrasado ou regularização:
1. **NÃO existe mais formulário web.** Toda a coleta de dados é conversacional, feita por você (ver seção "FECHAMENTO E COLETA DE DADOS").
2. Use a tool 'iniciar_fluxo_regularizacao' para introduzir o processo de forma natural.
3. Aguarde a resposta do cliente (Opção A ou Opção B):
   - **Se Opção A (Procuração e-CAC):** Use 'enviar_processo_autonomo'. Após o cliente confirmar que concluiu, use 'verificar_serpro_pos_ecac' IMEDIATAMENTE.
     - Sucesso → chame 'marcar_procuracao_concluida' e em seguida 'consultar_pgmei_serpro'.
     - Falha → peça print do e-CAC.
   - **Se Opção B (recusou e-CAC / prefere WhatsApp):** Use 'iniciar_coleta_situacao_whatsapp'. Em seguida, colete os dados conversacionalmente: CNPJ, Razão Social, CPF do empresário, E-mail, regime tributário, faturamento mensal, se tem dívidas e quais, e a Senha Gov.br. Salve cada informação obtida com update_user. Quando o cliente aprovar fechar o serviço, finalize com 'concluir_cadastro_fechamento' (passando opcao_b=true). **NÃO acione 'enviar_link_reuniao' neste fluxo** — o fechamento é automático.

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
- NUNCA use ferramentas/integrações não assinadas ou inativas na Loja Serpro (ex: DASN_SIMEI). Se o usuário pedir algo relacionado a declaração anual (DASN) ou qualquer serviço indisponível: chame 'chamar_atendente' com resumo do caso e informe ao cliente que um especialista vai entrar em contato. **NÃO sugira agendar reunião — o atendente que vai retornar.**
- **MUITO IMPORTANTE SOBRE VALORES:** Ao apresentar o resultado da consulta Serpro, você DEVE, OBRIGATORIAMENTE, informar ao cliente o **valor monetário exato** das dívidas (Soma pendente, R$, etc.) caso os detalhes da consulta tragam essa informação. Nunca esconda os valores. Dar essa clareza financeira é crucial para conscientizar o cliente do tamanho da dívida!
- Explicite ao cliente: "Para consultarmos as pendências do seu MEI com segurança, o primeiro passo é a Procuração e-CAC (Opção A)."

### FECHAMENTO E COLETA DE DADOS (FORMULÁRIO INVISÍVEL/CONVERSACIONAL)
Os formulários externos foram DESCONTINUADOS. Você, Apolo, atuará como um formulário inteligente e conversacional.
Assim que o cliente aprovar seguir com a regularização das pendências, siga este fluxo:
1. **Lista canônica de campos obrigatórios para fechar:** **Nome/Razão Social, CNPJ, CPF e E-mail** (o Telefone já é conhecido). A **Senha GOV** só é obrigatória na Opção B (atendimento humano sem procuração e-CAC) — nesse caso, pergunte a Senha Gov.br do cliente e salve com \`update_user(senha_gov=...)\` (é sensível; não repita a senha no chat depois de salvar).
2. **Auditoria de Dados:** Analise silenciosamente a tag \`<user_data>\` (que já inclui cpf, email, cnpj, razao_social, nome_completo). Se tiver dúvida sobre o que já existe no banco, chame \`consultar_dados_cliente\`.
3. **Dados Existentes:** Vários desses dados (Razão Social, CNPJ, CPF) já podem ter vindo das consultas Serpro/CCMEI. Não pergunte do zero aquilo que já está preenchido; se precisar, peça apenas confirmação de forma natural.
4. **Coleta Progressiva:** Para cada dado faltante (ex: E-mail), pergunte de forma amigável — UMA COISA POR VEZ: *"Excelente! Para formalizarmos o serviço e eu preparar a sua ata de fechamento, me confirma só o seu [DADO FALTANTE]?"*. Salve cada resposta na hora com \`update_user\` (ex: \`update_user(email='cliente@...')\`, \`update_user(cpf='...')\`).
5. **Fechamento (Ata):** Quando achar que coletou tudo, chame \`concluir_cadastro_fechamento\` com \`servico_fechado\` (o que foi acordado) e \`opcao_b\` se aplicável. A tool audita o banco: se ainda faltar algo, ela devolve a lista — volte ao passo 4 e colete o que falta. Se estiver completo, ela marca o lead como **pronto_faturamento** e **notifica o Haylander** automaticamente. **Nunca** grave manualmente "cadastro completo" em observacoes nem envie link de reunião neste fluxo — a tool faz tudo.

#### INTERPRETAÇÃO DO RESULTADO DE consultar_pgmei_serpro (CRÍTICO)
A tool consulta automaticamente os **últimos 6 anos** (sem precisar pedir). Campos principais:
- \`resumo_executivo\`: diagnóstico em texto — use como base para comunicar ao cliente.
- \`pgmei.situacao\` / \`pgfn.situacao\`: \`COM_DEBITO\` | \`SEM_DEBITO\` | \`INCONCLUSIVO\`
- \`pgmei.anos_com_debito\` / \`pgfn.anos_com_debito\`: lista de anos com débitos detectados
- \`aviso\` (se presente): instrução adicional — leia e siga.

**Regras de ouro:**
- \`COM_DEBITO\` → HÁ DÍVIDAS. Informe ao cliente os anos listados em \`anos_com_debito\`.
- \`SEM_DEBITO\` → situação regular em todos os anos consultados. Pode confirmar ao cliente.
- \`INCONCLUSIVO\` → NÃO diga "sem dívidas". Avise que não foi possível confirmar, use 'chamar_atendente' com um resumo do caso, e informe ao cliente que um especialista vai entrar em contato em breve. **NÃO sugira agendar reunião nesses casos.**
  - 🚫 **NUNCA INVENTE A CAUSA DA FALHA.** É TERMINANTEMENTE PROIBIDO afirmar motivos específicos que você não recebeu da tool — ex: "a PGFN só funciona das 07:05 às 22:00", "fora do horário de atendimento", "erro por causa do horário", "o sistema cai todo dia tal hora". Esses horários/regras NÃO existem e são alucinação. Diga apenas, genericamente, que "houve uma instabilidade momentânea nos sistemas da Receita e vamos reconsultar/encaminhar a um especialista". Nada além disso.
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

INCONCLUSIVO (serviço indisponível ou resposta parcial):
"Consultei o CNPJ [cnpj], mas não consegui confirmar a situação no momento — os sistemas da Receita podem estar com instabilidade.|||Já acionei nossa equipe. Um especialista vai entrar em contato com você em breve para dar continuidade. 🙏"
→ OBRIGATÓRIO: chame 'chamar_atendente' com resumo do caso ANTES de enviar a mensagem ao cliente. NÃO ofereça link de reunião.

REGRAS DE OURO DO TEMPLATE:
- NUNCA diga "sem dívidas" se pgmei.situacao OU pgfn.situacao for INCONCLUSIVO
- Sempre use '|||' para separar cada bloco de informação
- Substitua [cnpj] pelo CNPJ real — nunca exiba o campo bruto
- Termine com trial close (pergunta ou ação concreta)
- Se **pgfn_sem_procuracao = true**: a PGFN foi consultada sem procuração formal (API pública). Contextualize: "Encontrei uma indicação de dívida ativa de R$ X, mas para analisar os detalhes completos e as guias DAS em aberto, preciso da procuração e-CAC." Use como gancho para incentivar a procuração.
`;
/**
 * Tenta extrair texto de um PDF em base64 usando pdf-parse.
 * Retorna o texto extraído ou null em caso de falha.
 */
async function extractPdfText(base64) {
    try {
        const buffer = Buffer.from(base64, 'base64');
        const result = await (0, pdf_parse_1.default)(buffer);
        return result.text?.trim() || null;
    }
    catch {
        return null;
    }
}
/**
 * Detecta débitos a partir do texto extraído de um PDF da Serpro.
 * Retorna true se houver indicadores de dívida, false se regularizado, null se inconclusivo.
 */
function detectarDebitosNoPdf(texto) {
    const t = texto.toUpperCase();
    const INDICADORES_DEBITO = [
        'DEVEDOR', 'IRREGULAR', 'PENDENTE', 'INADIMPLENTE',
        'EM ABERTO', 'VENCIDO', 'DÍVIDA ATIVA', 'DIVIDA ATIVA',
        'GUIA EM ABERTO', 'DAS EM ABERTO', 'PARCELA EM ABERTO',
        'VALOR DEVIDO', 'TOTAL DEVIDO', 'DEBITO',
        'A VENCER', 'VENCIDA', 'NAO PAGO', 'NÃO PAGO',
        'PENDENTE DE PAGAMENTO', 'PERIODO DE APURACAO', 'PERÍODO DE APURAÇÃO',
        'VALOR PRINCIPAL', 'VALOR ORIGINAL', 'DAS EM ATRASO', 'GUIA VENCIDA',
        'COMPETENCIA', 'COMPETÊNCIA', 'PA EM ABERTO'
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
async function parseSerproData(envelope) {
    const NOT_FOUND = { tem_debitos_detectado: null, dados: null, tem_documento_binario: false, texto_pdf: null, mensagens_serpro: [], raw_envelope: envelope };
    if (!envelope || typeof envelope !== 'object')
        return NOT_FOUND;
    const env = envelope;
    const mensagensRaw = (Array.isArray(env.mensagens) ? env.mensagens : []);
    const mensagens_serpro = mensagensRaw.map(m => `[${m.codigo ?? '?'}] ${m.texto ?? ''}`).filter(Boolean);
    let dados = null;
    let tem_documento_binario = false;
    let texto_pdf = null;
    let dadosRaw = env.dados;
    // If dadosRaw is a string, try to parse it first
    let parsedDados = dadosRaw;
    if (typeof dadosRaw === 'string' && dadosRaw.length > 0) {
        try {
            parsedDados = JSON.parse(dadosRaw);
        }
        catch {
            // Not valid JSON, keep as is
        }
    }
    // ── Array de itens (PGFN_CONSULTAR / DIVIDA_ATIVA retornam array de débitos) ──
    if (Array.isArray(parsedDados)) {
        if (parsedDados.length > 0) {
            const DEBITO_STATUS = ['ENVIADO A PFN', 'DEVEDOR', 'INADIMPLENTE', 'PENDENTE', 'IRREGULAR', 'DEBITO'];
            const REGULAR_STATUS = ['ADIMPLENTE', 'REGULAR', 'SEM_DEBITO', 'SEM DEBITO'];
            let temDebito = false, temRegular = false;
            let somaValores = 0;
            for (const item of parsedDados) {
                const s = String(item.situacaoDebito ?? item.situacao ?? '')
                    .toUpperCase().trim().replace(/\s+/g, ' '); // Normalize multiple spaces
                if (DEBITO_STATUS.some(d => s.includes(d))) {
                    temDebito = true;
                    if (item.valor)
                        somaValores += Number(item.valor) || 0;
                }
                if (REGULAR_STATUS.some(d => s.includes(d))) {
                    temRegular = true;
                }
            }
            const resumo_valores = somaValores > 0 ? `Soma pendente: R$ ${somaValores.toFixed(2)}` : null;
            return {
                tem_debitos_detectado: temDebito ? true : (temRegular ? false : null),
                dados: null, tem_documento_binario: false, texto_pdf: null, resumo_valores, mensagens_serpro, raw_envelope: envelope,
            };
        }
        // Array vazio → sinal definitivo vem das mensagens (ex: código 25001 = sem débitos)
        const msTexto = mensagensRaw.map(m => `${m.codigo ?? ''} ${m.texto ?? ''}`).join(' ')
            .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' '); // Normalize multiple spaces
        const comDebito = ['ENVIADO A PFN', 'EM DEBITO', 'DEVEDOR', 'INADIMPLENTE'].some(s => msTexto.includes(s));
        const semDebito = ['NAO HA DEBITOS', 'SEM DEBITO', '25001', 'SITUACAO REGULAR', 'NADA CONSTA'].some(s => msTexto.includes(s));
        return {
            tem_debitos_detectado: comDebito ? true : (semDebito ? false : null),
            dados: null, tem_documento_binario: false, texto_pdf: null, mensagens_serpro, raw_envelope: envelope,
        };
    }
    if (typeof dadosRaw === 'string' && dadosRaw.length > 0) {
        try {
            const parsed = JSON.parse(dadosRaw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                dados = parsed;
            }
        }
        catch {
            // dados não é JSON válido → tenta extrair como PDF base64
            tem_documento_binario = true;
            texto_pdf = await extractPdfText(dadosRaw);
        }
    }
    else if (dadosRaw && typeof dadosRaw === 'object' && !Array.isArray(dadosRaw)) {
        dados = dadosRaw;
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
    for (const doc of documentos) {
        if (typeof doc.conteudo === 'string' && doc.conteudo.length > 0 && !texto_pdf) {
            tem_documento_binario = true;
            texto_pdf = await extractPdfText(doc.conteudo);
            if (texto_pdf)
                break;
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
            raw_envelope: envelope,
        };
    }
    // Documento sem texto legível (PDF escaneado ou erro de extração)
    if (tem_documento_binario) {
        return { tem_debitos_detectado: null, dados: null, tem_documento_binario: true, texto_pdf: null, mensagens_serpro, raw_envelope: envelope };
    }
    if (!dados) {
        // Sem dados estruturados — tenta mensagens como último sinal
        const msTexto = mensagensRaw.map(m => `${m.codigo ?? ''} ${m.texto ?? ''}`).join(' ')
            .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
        const comDebito = ['ENVIADO A PFN', 'EM DEBITO', 'DEVEDOR', 'INADIMPLENTE'].some(s => msTexto.includes(s));
        const semDebito = ['NAO HA DEBITOS', 'SEM DEBITO', '25001', 'SITUACAO REGULAR', 'NADA CONSTA'].some(s => msTexto.includes(s));
        return {
            tem_debitos_detectado: comDebito ? true : (semDebito ? false : null),
            dados: null, tem_documento_binario: false, texto_pdf: msTexto, resumo_valores: null, mensagens_serpro, raw_envelope: envelope,
        };
    }
    // Detectar débitos a partir dos campos JSON conhecidos
    const situacao = String(dados.situacaoContribuinte ?? dados.situacao ?? dados.statusContribuinte ?? '').toUpperCase();
    const guiasRaw = dados.guiasEmAberto ?? dados.debitos ?? dados.debitosPGMEI ?? dados.debitosTotal ?? dados.guias ?? dados.das ?? dados.parcelas ?? dados.itens ?? dados.lista ?? dados.periodos ?? dados.competencias ?? dados.guiaVencida ?? dados.dasGerado ?? null;
    const hasGuias = Array.isArray(guiasRaw) ? guiasRaw.length > 0
        : typeof guiasRaw === 'number' ? guiasRaw > 0
            : false;
    // Campos numéricos indicando dívida (Serpro pode retornar valorPrincipal, valorOriginal, etc.)
    const valorPrincipal = typeof dados.valorPrincipal === 'number' ? dados.valorPrincipal
        : typeof dados.valorOriginal === 'number' ? dados.valorOriginal
            : typeof dados.periodoApuracao === 'string' ? 1 // presença de período = há guia
                : 0;
    const INDICADORES_REGULAR = ['SEM_DEBITO', 'REGULAR', 'ADIMPLENTE', 'SEM DEBITO', 'SEM DÉBITO', 'EM DIA', 'NADA CONSTA'];
    const INDICADORES_DEBITO = ['DEVEDOR', 'IRREGULAR', 'PENDENTE', 'INADIMPLENTE', 'DEBITO', 'VENCID', 'EM ABERTO', 'A VENCER', 'NAO PAGO'];
    // Checar REGULAR primeiro — 'SEM_DEBITO' contém 'DEBITO' como substring
    const tem_debitos_detectado = INDICADORES_REGULAR.some(i => situacao.includes(i)) ? false
        : INDICADORES_DEBITO.some(i => situacao.includes(i)) || hasGuias || valorPrincipal > 0 ? true
            : null;
    let resumo_valores = null;
    if (tem_debitos_detectado) {
        const valores = [];
        if (valorPrincipal > 0)
            valores.push(`R$ ${valorPrincipal.toFixed(2)}`);
        if (Array.isArray(guiasRaw)) {
            const sum = guiasRaw.reduce((acc, g) => acc + (Number(g.valor) || Number(g.valorPrincipal) || 0), 0);
            if (sum > 0)
                valores.push(`Soma das guias R$ ${sum.toFixed(2)}`);
        }
        if (valores.length > 0)
            resumo_valores = valores.join(', ');
    }
    return { tem_debitos_detectado, dados, tem_documento_binario: false, texto_pdf: null, resumo_valores, mensagens_serpro, raw_envelope: envelope };
}
const getRegularizacaoTools = (context) => [
    // ── Camada 1 ────────────────────────────────────────────────────────────────
    {
        name: 'consultar_pgmei_serpro',
        description: 'Camada 1: busca débitos PGMEI (DAS MEI) e Dívida Ativa PGFN nos últimos 6 anos automaticamente. Primeira consulta após Procuração confirmada.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const gate = await resolveUserCnpjAndProcuracaoStatus(p, context.userPhone);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }
                const currentYear = new Date().getFullYear();
                const anos = Array.from({ length: ANOS_RETROATIVOS + 1 }, (_, i) => currentYear - ANOS_RETROATIVOS + i);
                // DASN-SIMEI NÃO é consultada aqui: o serviço está "em prospecção" na Serpro
                // (ainda não liberado em produção — ICGERENCIADOR-044). Chamá-la só desperdiçaria
                // uma requisição que sempre retorna 403. Reativar quando a Serpro publicar o serviço.
                const [pgmeiRawAll, pgfnRaw] = await Promise.all([
                    Promise.allSettled(anos.map(ano => (0, server_tools_1.checkCnpjSerpro)(gate.cnpj, 'PGMEI', { ano: String(ano) }))),
                    Promise.resolve((0, pgfn_1.consultarDividaAtivaPorDevedor)(gate.cnpj)).then(result => ({ status: 'fulfilled', value: result }), reason => ({ status: 'rejected', reason }))
                ]);
                const parseAnoResults = async (rawAll) => Promise.all(rawAll.map(async (result, i) => {
                    const ano = anos[i];
                    if (result.status === 'rejected')
                        return { ano, tem_debitos: null };
                    try {
                        const envelope = JSON.parse(result.value);
                        const parsed = await parseSerproData(envelope);
                        return {
                            ano,
                            tem_debitos: parsed.tem_debitos_detectado,
                            detalhe: parsed.resumo_valores || (parsed.texto_pdf ? parsed.texto_pdf.slice(0, 150).replace(/\\n/g, ' ') : undefined),
                        };
                    }
                    catch {
                        return { ano, tem_debitos: null };
                    }
                }));
                const pgmeiPorAno = await parseAnoResults(pgmeiRawAll);
                const pgfnPorAno = pgfnRaw.status === 'fulfilled'
                    ? [{
                            ano: currentYear,
                            tem_debitos: pgfnRaw.value.tem_debitos_detectado,
                            detalhe: pgfnRaw.value.mensagens_pgfn.join(' | ') || undefined,
                        }]
                    : [{ ano: currentYear, tem_debitos: null, detalhe: String(pgfnRaw.reason) }];
                const pgmei = formatServicoResult(pgmeiPorAno);
                const pgfn = formatServicoResult(pgfnPorAno);
                const pgfn_detalhes = pgfnRaw.status === 'fulfilled' ? pgfnRaw.value.resumo : undefined;
                // DASN-SIMEI indisponível na Serpro (em prospecção). Não consultada — não afirmar nada sobre ela.
                const dasn_result = null;
                const dasn_info = 'DASN-SIMEI indisponível (serviço ainda não liberado pela Serpro).';
                const resumo_executivo = buildResumoExecutivo(pgmei, pgfn, pgfn_detalhes);
                const aviso = pgmei.situacao === 'COM_DEBITO' || pgfn.situacao === 'COM_DEBITO'
                    ? '⚠️ Débitos encontrados. Informe ao cliente os anos com pendências e oriente a regularização.'
                    : pgmei.situacao === 'INCONCLUSIVO' || pgfn.situacao === 'INCONCLUSIVO'
                        ? '⚠️ Resultado inconclusivo em alguns anos. Não afirme "sem dívidas" sem verificação adicional.'
                        : undefined;
                // Atualiza a ficha do lead com os dados reais encontrados
                const tem_divida = pgmei.situacao === 'COM_DEBITO' || pgfn.situacao === 'COM_DEBITO';
                let tipo_divida = '';
                if (pgmei.situacao === 'COM_DEBITO' && pgfn.situacao === 'COM_DEBITO')
                    tipo_divida = 'Federal e DAS';
                else if (pgfn.situacao === 'COM_DEBITO')
                    tipo_divida = 'Federal';
                else if (pgmei.situacao === 'COM_DEBITO')
                    tipo_divida = 'DAS';
                const valor_divida_pgfn = pgfn_detalhes?.valor_total_consolidado || 0;
                (0, server_tools_1.updateUser)({
                    telefone: context.userPhone,
                    tem_divida,
                    tipo_divida: tipo_divida || undefined,
                    valor_divida_pgfn
                }).catch(err => console.error('[consultar_pgmei_serpro] Erro ao atualizar lead:', err));
                return JSON.stringify({ status: 'success', resumo_executivo, pgmei, pgfn, pgfn_detalhes, dasn_info, dasn_result, aviso, pgfn_sem_procuracao: !!gate.bypass_reason });
            }
            catch (error) {
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
                const segments = (0, regularizacao_system_1.createRegularizacaoMessageSegments)();
                await processMessageSegments(context.userPhone, segments, (s) => (0, server_tools_1.sendMessageSegment)(context.userPhone, s));
                return JSON.stringify({ status: 'success', message: 'Fluxo de regularização iniciado' });
            }
            catch (error) {
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
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                let leadId = null;
                if (ud) {
                    const p = JSON.parse(ud);
                    if (p.status !== 'error' && p.status !== 'not_found')
                        leadId = p.id;
                }
                const segments = (0, regularizacao_system_1.createAutonomoMessageSegments)();
                await processMessageSegments(context.userPhone, segments, (s) => (0, server_tools_1.sendMessageSegment)(context.userPhone, s));
                if (leadId) {
                    await (0, server_tools_1.trackResourceDelivery)(leadId, 'link-ecac', 'https://cav.receita.fazenda.gov.br/autenticacao/login');
                    await (0, server_tools_1.trackResourceDelivery)(leadId, 'video-tutorial', 'video-tutorial-procuracao-ecac');
                }
                return JSON.stringify({ status: 'success' });
            }
            catch (error) {
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
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const completed = await (0, server_tools_1.checkProcuracaoStatus)(p.id);
                return JSON.stringify({ status: 'success', completed, message: completed ? 'Procuração já concluída' : 'Procuração pendente' });
            }
            catch (error) {
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
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                await (0, server_tools_1.markProcuracaoCompleted)(p.id);
                return JSON.stringify({ status: 'success' });
            }
            catch (error) {
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
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                if (!p.id)
                    return JSON.stringify({ status: 'error', message: 'Usuário sem ID interno. Atualize o cadastro.' });
                const redisCnpjAtivo = await redis_1.default.get(`session:cnpj_ativo:${p.id}`).catch(() => null);
                const resLead = await db_1.default.query('SELECT cnpj FROM leads WHERE id = $1 LIMIT 1', [p.id]);
                const leadRow = resLead.rows[0] || {};
                const cnpj = (redisCnpjAtivo?.replace(/\D/g, '') || leadRow.cnpj);
                if (!cnpj)
                    return JSON.stringify({ status: 'error', message: 'CNPJ não cadastrado. Peça o print.' });
                const serproResult = await (0, server_tools_1.consultarProcuracaoSerpro)(cnpj);
                const parsed = JSON.parse(serproResult);
                if (parsed.status === 'error') {
                    if (parsed.error_type === 'procuracao_ausente') {
                        return JSON.stringify({ status: 'error', message: 'Procuração não detectada no Serpro. O cliente pode ter esquecido de assinar ou salvar.' });
                    }
                    return JSON.stringify({ status: 'error', message: `Erro Serpro: ${parsed.message}` });
                }
                // Sincroniza imediatamente no banco para refletir na lista sem depender
                // de chamada adicional de ferramenta.
                await (0, server_tools_1.markProcuracaoCompleted)(p.id);
                return JSON.stringify({
                    status: 'success',
                    message: 'Procuração validada com sucesso via Serpro e sincronizada no cadastro.',
                    procuracao_ativa: true,
                    serpro_dados: parsed,
                });
            }
            catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    // ── Opção B: coleta in-chat ──────────────────────────────────────────────────
    {
        name: 'iniciar_coleta_situacao_whatsapp',
        description: 'Inicia coleta conversacional de dados do lead pelo WhatsApp quando o cliente recusa a Opção A (e-CAC). Instrui o agente a coletar CNPJ, Razão Social, CPF, E-mail, faturamento e dívidas via update_user. Quando o cliente aprovar fechar o serviço, finalize com concluir_cadastro_fechamento (opcao_b=true).',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                let leadId = null;
                if (ud) {
                    const p = JSON.parse(ud);
                    if (p.status !== 'error' && p.status !== 'not_found')
                        leadId = p.id;
                }
                // Removido o envio de formulário web (createSituacaoFormSegments)
                // Agora o Apolo apenas recebe a instrução para iniciar a coleta conversacional
                if (leadId)
                    await (0, server_tools_1.trackResourceDelivery)(leadId, 'situacao-form-whatsapp', 'started');
                return JSON.stringify({
                    status: 'success',
                    next_steps: 'Faça perguntas conversacionais, UMA por vez, para coletar: CNPJ, Razão Social, CPF empresário, E-mail, faturamento_mensal, tem_divida, detalhes dívidas. Salve cada resposta com update_user. Quando o cliente aprovar fechar o serviço, finalize com concluir_cadastro_fechamento (opcao_b=true). NÃO use enviar_link_reuniao.'
                });
            }
            catch (error) {
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
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const gate = await resolveUserCnpjAndProcuracaoStatus(p, context.userPhone);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }
                const raw = await (0, server_tools_1.checkCnpjSerpro)(gate.cnpj, 'CCMEI_DADOS');
                const envelope = JSON.parse(raw);
                const dadosRaw = envelope.dados ?? envelope.primary?.dados;
                const mensagens = (envelope.mensagens ?? envelope.primary?.mensagens);
                if (!dadosRaw || dadosRaw === '') {
                    const msg = mensagens?.[0]?.texto ?? 'Sem dados cadastrais disponíveis.';
                    return JSON.stringify({ status: 'aviso', message: msg });
                }
                const dados = (typeof dadosRaw === 'string' ? JSON.parse(dadosRaw) : dadosRaw);
                return JSON.stringify({ status: 'success', dados });
            }
            catch (error) {
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
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const gate = await resolveUserCnpjAndProcuracaoStatus(p, context.userPhone);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }
                const pgfn = await (0, pgfn_1.consultarDividaAtivaPorDevedor)(gate.cnpj);
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
            }
            catch (error) {
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
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
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
                const solicitacaoRaw = await (0, server_tools_1.checkCnpjSerpro)(gate.cnpj, 'SIT_FISCAL_SOLICITAR', { cpf });
                const solicitacao = JSON.parse(solicitacaoRaw);
                if (solicitacao.status === 'error')
                    return solicitacaoRaw;
                const protocolo = extractSitfisProtocolo(solicitacao);
                if (!protocolo) {
                    return JSON.stringify({ status: 'error', message: 'Protocolo SITFIS não retornado. Tente novamente em instantes.' });
                }
                // Aguarda processamento do Serpro
                await new Promise(r => setTimeout(r, 4000));
                // Passo 2: emitir relatório
                const resultado = await (0, server_tools_1.checkCnpjSerpro)(gate.cnpj, 'SIT_FISCAL_RELATORIO', { cpf, protocoloRelatorio: protocolo });
                return resultado;
            }
            catch (error) {
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
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
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
                const solicitacaoRaw = await (0, server_tools_1.checkCnpjSerpro)(gate.cnpj, 'SIT_FISCAL_SOLICITAR', { cpf });
                const solicitacao = JSON.parse(solicitacaoRaw);
                if (solicitacao.status === 'error')
                    return solicitacaoRaw;
                const protocolo = extractSitfisProtocolo(solicitacao);
                if (!protocolo) {
                    return JSON.stringify({ status: 'error', message: 'Protocolo SITFIS não obtido. CND não pôde ser emitida.' });
                }
                await new Promise(r => setTimeout(r, 4000));
                // Passo 2: emitir CND
                const resultado = await (0, server_tools_1.checkCnpjSerpro)(gate.cnpj, 'CND', { cpf, protocoloRelatorio: protocolo });
                return resultado;
            }
            catch (error) {
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
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const gate = await resolveUserCnpjAndProcuracaoStatus(p, context.userPhone);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }
                const raw = await (0, server_tools_1.checkCnpjSerpro)(gate.cnpj, 'CAIXA_POSTAL');
                const envelope = JSON.parse(raw);
                const dadosRaw = envelope.dados;
                const mensagens = envelope.mensagens;
                if (!dadosRaw || dadosRaw === '' || dadosRaw === '[]') {
                    const msg = mensagens?.[0]?.texto ?? 'Nenhuma mensagem na Caixa Postal.';
                    return JSON.stringify({ status: 'success', mensagens: [], message: msg });
                }
                const dados = (typeof dadosRaw === 'string' ? JSON.parse(dadosRaw) : dadosRaw);
                return JSON.stringify({ status: 'success', dados });
            }
            catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    // ── Fechamento: gera a ata e entrega o lead pronto para o Haylander faturar ────
    {
        name: 'concluir_cadastro_fechamento',
        description: 'FECHAMENTO. Chame quando o cliente aprovou o serviço e você acredita ter coletado todos os dados obrigatórios (Nome/Razão Social, CNPJ, CPF, E-mail). A tool audita a ficha no banco: se faltar algo, retorna a lista de campos para você continuar a coleta conversacional (UMA pergunta por vez). Se estiver completa, marca o lead como pronto_faturamento e notifica o Haylander com a ata. NÃO envie link de reunião neste fluxo.',
        parameters: {
            type: 'object',
            properties: {
                servico_fechado: { type: 'string', description: 'O que foi acordado com o cliente (ex: "Regularização MEI — DAS 2021 a 2023" ou "Abertura de empresa").' },
                opcao_b: { type: 'boolean', description: 'true se o cliente seguiu a Opção B (atendimento humano sem procuração e-CAC). Nesse caso a Senha GOV também é obrigatória.' }
            },
            required: ['servico_fechado']
        },
        function: async (args) => {
            try {
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const lead = JSON.parse(ud);
                if (lead.status === 'error' || lead.status === 'not_found') {
                    return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                }
                const precisaSenhaGov = args.opcao_b === true || args.opcao_b === 'true';
                const { completo, faltando } = (0, closing_audit_1.auditarCadastroCompleto)(lead, precisaSenhaGov);
                if (!completo) {
                    return JSON.stringify({
                        status: 'incompleto',
                        faltando,
                        next_steps: `Ainda faltam dados para fechar: ${faltando.join(', ')}. Peça-os de forma conversacional, UMA pergunta por vez, e salve cada resposta com update_user. Depois chame concluir_cadastro_fechamento de novo. NÃO chame enviar_link_reuniao.`
                    });
                }
                const servico = String(args.servico_fechado || 'Serviço de regularização');
                const observacao = `✅ CADASTRO COMPLETO — Ata de fechamento pronta para faturamento. Serviço: ${servico}.`;
                // Não marcamos situacao='cliente' aqui: o pagamento ainda não foi confirmado.
                // O sinal de "pronto para faturar" é o status_atendimento — Haylander marca
                // cliente após a cobrança.
                await (0, server_tools_1.updateUser)({
                    telefone: context.userPhone,
                    servico,
                    status_atendimento: 'pronto_faturamento',
                    observacoes: observacao,
                });
                const nome = (lead.nome_completo || lead.razao_social || 'Cliente');
                const dividaInfo = lead.tem_divida
                    ? `Dívida: ${lead.tipo_divida || 'sim'}${lead.valor_divida_pgfn ? ` (R$ ${lead.valor_divida_pgfn})` : ''}`
                    : 'Sem dívida registrada';
                const ata = `💰 LEAD PRONTO PARA FATURAR\n\n` +
                    `Cliente: ${nome}\n` +
                    `Telefone: ${context.userPhone}\n` +
                    `CNPJ: ${lead.cnpj}\n` +
                    `CPF: ${lead.cpf}\n` +
                    `E-mail: ${lead.email}\n` +
                    `Serviço fechado: ${servico}\n` +
                    `${dividaInfo}\n\n` +
                    `Ação: cadastro completo e procuração/dados ok. Só falta cobrar o pagamento.`;
                await (0, server_tools_1.callAttendant)(context.userPhone, ata);
                return JSON.stringify({
                    status: 'success',
                    message: 'Cadastro fechado, lead marcado como pronto_faturamento e Haylander notificado.',
                    next_steps: 'Avise o cliente que o cadastro está pronto e o processo foi oficialmente iniciado. Mantenha-o engajado para a etapa de pagamento. NÃO envie link de reunião.'
                });
            }
            catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
];
exports.getRegularizacaoTools = getRegularizacaoTools;
//# sourceMappingURL=workflow-regularizacao.js.map