import { ToolDefinition } from '../../openai-client';
import { checkProcuracaoStatus, markProcuracaoCompleted, checkCnpjSerpro, consultarProcuracaoSerpro, trackResourceDelivery, sendMessageSegment, getUser } from '../../server-tools';
import pool from '../../../lib/db';
import { createRegularizacaoMessageSegments, createAutonomoMessageSegments, createAssistidoMessageSegments, createSituacaoFormSegments, MessageSegment } from '../../regularizacao-system';
import { AgentContext } from '../../types';

async function processMessageSegments(phone: string, segments: MessageSegment[], sender: (segment: MessageSegment) => Promise<void>): Promise<void> {
    for (const segment of segments) {
        if (segment.delay && segment.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, segment.delay));
        }
        await sender(segment);
    }
}

async function resolveUserCnpjAndProcuracaoStatus(userData: any): Promise<{
    ok: boolean;
    cnpj?: string;
    message?: string;
}> {
    if (!userData?.id) {
        return { ok: false, message: 'Usuário sem identificação interna. Atualize o cadastro antes da consulta.' };
    }

    let cnpj = userData.cnpj as string | undefined;
    if (!cnpj) {
        const resLead = await pool.query('SELECT cnpj FROM leads WHERE id = $1 LIMIT 1', [userData.id]);
        if (resLead.rows.length > 0) cnpj = resLead.rows[0].cnpj;
    }

    if (!cnpj) {
        return { ok: false, message: 'CNPJ não localizado. Peça ao cliente para confirmar os dados cadastrais.' };
    }

    const procRes = await pool.query(
        'SELECT procuracao, procuracao_ativa FROM leads_processo WHERE lead_id = $1 LIMIT 1',
        [userData.id]
    );
    const procRow = procRes.rows[0] || {};
    const hasFormalProcuracao = Boolean(procRow.procuracao) || Boolean(procRow.procuracao_ativa);
    const hasTrackedCompletion = await checkProcuracaoStatus(userData.id);

    if (!hasFormalProcuracao && !hasTrackedCompletion) {
        return {
            ok: false,
            message: 'Consulta Serpro bloqueada: primeiro confirme a Procuração e-CAC (Opção A) e valide com verificar_procuracao_status/verificar_serpro_pos_ecac.'
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
- Explicite ao cliente: "Para consultarmos as pendências do seu MEI com segurança, o primeiro passo é a Procuração e-CAC (Opção A)."
`;

export const getRegularizacaoTools = (context: AgentContext): ToolDefinition[] => [
    // ── Camada 1 ────────────────────────────────────────────────────────────────
    {
        name: 'consultar_pgmei_serpro',
        description: 'Camada 1: busca débitos PGMEI (DAS MEI) e Dívida Ativa PGFN simultaneamente. Primeira consulta após Procuração confirmada.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }

                const [pgmeiResult, pgfnResult] = await Promise.allSettled([
                    checkCnpjSerpro(gate.cnpj, 'PGMEI'),
                    checkCnpjSerpro(gate.cnpj, 'PGFN_CONSULTAR'),
                ]);

                const pgmei = pgmeiResult.status === 'fulfilled' ? JSON.parse(pgmeiResult.value) : { status: 'error', message: 'Falha ao consultar PGMEI' };
                const pgfn  = pgfnResult.status  === 'fulfilled' ? JSON.parse(pgfnResult.value)  : { status: 'error', message: 'Falha ao consultar PGFN' };

                return JSON.stringify({ status: 'success', pgmei, pgfn });
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

                let cnpj = p.cnpj as string | undefined;
                if (!cnpj && p.id) {
                    const res = await pool.query('SELECT cnpj FROM leads WHERE id = $1 LIMIT 1', [p.id]);
                    if (res.rows.length > 0) cnpj = res.rows[0].cnpj;
                }
                if (!cnpj) return JSON.stringify({ status: 'error', message: 'CNPJ não cadastrado. Peça o print.' });

                const serproResult = await consultarProcuracaoSerpro(cnpj);
                const parsed = JSON.parse(serproResult) as Record<string, unknown>;

                if (parsed.status === 'error') {
                    if (parsed.error_type === 'procuracao_ausente') {
                        return JSON.stringify({ status: 'error', message: 'Procuração não detectada no Serpro. O cliente pode ter esquecido de assinar ou salvar.' });
                    }
                    return JSON.stringify({ status: 'error', message: `Erro Serpro: ${parsed.message}` });
                }

                return JSON.stringify({ status: 'success', message: 'Procuração validada com sucesso via Serpro.', serpro_dados: parsed });
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
                const segments = createSituacaoFormSegments();
                await processMessageSegments(context.userPhone, segments, (s) => sendMessageSegment(context.userPhone, s));
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

                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
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
        description: 'Consulta débitos em Dívida Ativa da União (somente após Procuração confirmada).',
        parameters: { type: 'object', properties: { ano: { type: 'string', description: 'Ano (ex: "2024"). Padrão: ano atual.' } } },
        function: async (args: any) => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message });
                }

                return await checkCnpjSerpro(gate.cnpj, 'DIVIDA_ATIVA', { ano: args.ano || String(new Date().getFullYear()) });
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

                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
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

                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
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

                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
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
