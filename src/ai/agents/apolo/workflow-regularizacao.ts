import { ToolDefinition } from '../../openai-client';
import { checkProcuracaoStatus, markProcuracaoCompleted, checkCnpjSerpro, consultarProcuracaoSerpro, trackResourceDelivery, sendMessageSegment, getUser } from '../../server-tools';
import pool from '../../../lib/db';
import { createRegularizacaoMessageSegments, createAutonomoMessageSegments, createAssistidoMessageSegments, MessageSegment } from '../../regularizacao-system';
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

export const REGULARIZACAO_RULES = `
# Regras de Regularização e Conformidade Serpro
### Fluxo de Regularização (Dívidas, PGMEI, Abertura/Baixa)
Se o cliente mencionar dívidas, pendências, boleto atrasado ou regularização:
1. **NÃO ENVIE O FORMULÁRIO AINDA.**
2. Use a tool 'iniciar_fluxo_regularizacao' para introduzir o processo de forma natural.
3. Aguarde a resposta do cliente (Opção A - Procuração vs Opção B - Acesso Direto).
4. Se Opção A (Procuração): Use 'enviar_processo_autonomo'.
5. Após a conclusão da Procuração, use 'verificar_serpro_pos_ecac' IMEDIATAMENTE.
   - Sucesso -> chame 'marcar_procuracao_concluida' e em seguida 'consultar_pgmei_serpro'.
   - Falha -> peça print do e-CAC.

- **MEI Excluído ou Desenquadrado:**
  Ofereça duas opções claras:
  Opção 1 (Procuração): Regularizar agora e aguardar (valor menor, sem Gov).
  Opção 2 (Acesso Direto): Baixar atual e abrir novo (valor maior, exige Gov).

### CONSULTAS SERPRO — REGRAS ESTRITAS E CAMADAS
- **NÃO FAÇA** nenhuma consulta Serpro sem Procuração confirmada (verificar_procuracao_status ou fluxo explícito).
- **CAMADA 1 (padrão):** Use 'consultar_pgmei_serpro' — retorna PGMEI (débitos DAS) e PGFN (Dívida Ativa). Rápida, focada, sem custo excessivo.
- **CAMADA 2 (somente se necessário):** Use 'consultar_divida_ativa_serpro' ou 'consultar_situacao_fiscal_serpro' para casos específicos onde a Camada 1 não foi suficiente ou o atendente humano solicitou varredura completa.
- O uso desenfreado de consultas profundas gasta recursos e expõe nossos IPs. Prefira sempre a Camada 1.
- Explicite ao cliente: "Para consultarmos as pendências do seu MEI com segurança, o primeiro passo é a Procuração e-CAC (Opção A)."
`;

export const getRegularizacaoTools = (context: AgentContext): ToolDefinition[] => [
    {
        name: 'consultar_pgmei_serpro',
        description: 'Camada 1 de consulta Serpro: busca débitos PGMEI (DAS MEI) e Dívida Ativa PGFN simultaneamente. Use como primeira consulta após a Procuração confirmada. NÃO realiza varredura fiscal profunda (SITFIS/municipal/estadual).',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: 'error', message: 'Usuário não encontrado' });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: 'error', error_type: 'procuracao_obrigatoria', message: gate.message || 'Procuração obrigatória para consulta Serpro.' });
                }

                const [pgmeiResult, pgfnResult] = await Promise.allSettled([
                    checkCnpjSerpro(gate.cnpj, 'PGMEI'),
                    checkCnpjSerpro(gate.cnpj, 'PGFN_CONSULTAR'),
                ]);

                const pgmei = pgmeiResult.status === 'fulfilled' ? JSON.parse(pgmeiResult.value) : { status: 'error', message: 'Falha ao consultar PGMEI' };
                const pgfn = pgfnResult.status === 'fulfilled' ? JSON.parse(pgfnResult.value) : { status: 'error', message: 'Falha ao consultar PGFN' };

                return JSON.stringify({ status: 'success', pgmei, pgfn });
            } catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    {
        name: 'iniciar_fluxo_regularizacao', description: 'Inicia o fluxo de regularização fiscal aprimorado.', parameters: { type: 'object', properties: {} },
        function: async () => { try { const segments = createRegularizacaoMessageSegments(); await processMessageSegments(context.userPhone, segments, (segment) => sendMessageSegment(context.userPhone, segment)); return JSON.stringify({ status: "success", message: "Fluxo de regularização iniciado" }); } catch (error) { return JSON.stringify({ status: "error", message: String(error) }); } }
    },
    {
        name: 'enviar_processo_autonomo', description: 'Envia o processo autônomo de procuração e-CAC regularização.', parameters: { type: 'object', properties: {} },
        function: async () => { try { const ud = await getUser(context.userPhone); let leadId = null; if (ud) { const p = JSON.parse(ud); if (p.status !== 'error' && p.status !== 'not_found') leadId = p.id; } const segments = createAutonomoMessageSegments(); await processMessageSegments(context.userPhone, segments, (s) => sendMessageSegment(context.userPhone, s)); if (leadId) { await trackResourceDelivery(leadId, 'link-ecac', 'https://cav.receita.fazenda.gov.br/autenticacao/login'); await trackResourceDelivery(leadId, 'video-tutorial', 'video-tutorial-procuracao-ecac'); } return JSON.stringify({ status: "success" }); } catch (error) { return JSON.stringify({ status: "error", message: String(error) }); } }
    },
    {
        name: 'verificar_procuracao_status', description: 'Verifica se o cliente já concluiu a procuração.', parameters: { type: 'object', properties: {} },
        function: async () => { try { const ud = await getUser(context.userPhone); if (!ud) return JSON.stringify({ status: "error", message: "Usuário não encontrado" }); const p = JSON.parse(ud); if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: "error", message: "Usuário não encontrado" }); const completed = await checkProcuracaoStatus(p.id); return JSON.stringify({ status: "success", completed, message: completed ? "Procuração já concluída" : "Procuração pendente" }); } catch (error) { return JSON.stringify({ status: "error", message: String(error) }); } }
    },
    {
        name: 'marcar_procuracao_concluida', description: 'Marca a procuração como concluída.', parameters: { type: 'object', properties: {} },
        function: async () => { try { const ud = await getUser(context.userPhone); if (!ud) return JSON.stringify({ status: "error", message: "Usuário não encontrado" }); const p = JSON.parse(ud); if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: "error", message: "Usuário não encontrado" }); await markProcuracaoCompleted(p.id); return JSON.stringify({ status: "success" }); } catch (error) { return JSON.stringify({ status: "error", message: String(error) }); } }
    },
    {
        name: 'verificar_serpro_pos_ecac', description: 'Verifica no Serpro se a procuração ou cadastro do cliente reflete no sistema governamental após ele afirmar conclusão no e-CAC.', parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: "error", message: "Usuário não encontrado" });

                let cnpj = p.cnpj;
                if (!cnpj && p.id) {
                    const resLead = await pool.query('SELECT cnpj FROM leads WHERE id = $1 LIMIT 1', [p.id]);
                    if (resLead.rows.length > 0) cnpj = resLead.rows[0].cnpj;
                }

                if (!cnpj) return JSON.stringify({ status: "error", message: "CNPJ não cadastrado. Peça o print." });

                try {
                    const serproResult = await consultarProcuracaoSerpro(cnpj);
                    const parsedResult = JSON.parse(serproResult);
                    
                    if (parsedResult.status === 'error') {
                        if (parsedResult.error_type === 'procuracao_ausente') {
                            return JSON.stringify({ status: "error", message: "Procuração não detectada no sistema Serpro. O cliente pode ter esquecido de assinar ou salvar." });
                        }
                       return JSON.stringify({ status: "error", message: `Erro na comunicação com o Serpro: ${parsedResult.message}` });
                    }

                    return JSON.stringify({ status: "success", message: "Procuração validada com sucesso via Serpro.", serpro_dados: parsedResult });
                } catch (serproError) {
                    return JSON.stringify({ status: "error", message: "Erro técnico na comunicação com Serpro. Peça um print do e-CAC." });
                }
            } catch (error) {
                return JSON.stringify({ status: "error", message: String(error) });
            }
        }
    },
    {
        name: 'consultar_divida_ativa_serpro', description: 'Consulta débitos em Dívida Ativa da União via Serpro (somente após Procuração confirmada).', parameters: { type: 'object', properties: { ano: { type: 'string', description: 'Ano opcional (ex: 2024). Padrão é ano atual.' } } },
        function: async (args: any) => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: "error", message: "Usuário não encontrado" });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: "error", error_type: "procuracao_obrigatoria", message: gate.message || "Procuração obrigatória para consulta Serpro." });
                }

                const result = await checkCnpjSerpro(gate.cnpj, 'DIVIDA_ATIVA', { ano: args.ano || new Date().getFullYear().toString() });
                return result;
            } catch (error) {
                return JSON.stringify({ status: "error", message: String(error) });
            }
        }
    },
    {
        name: 'consultar_situacao_fiscal_serpro', description: 'Solicita relatório de Situação Fiscal Completa via Serpro (somente após Procuração confirmada).', parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await getUser(context.userPhone);
                if (!ud) return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found') return JSON.stringify({ status: "error", message: "Usuário não encontrado" });

                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: "error", error_type: "procuracao_obrigatoria", message: gate.message || "Procuração obrigatória para consulta Serpro." });
                }

                const result = await checkCnpjSerpro(gate.cnpj, 'SIT_FISCAL');
                return result;
            } catch (error) {
                return JSON.stringify({ status: "error", message: String(error) });
            }
        }
    }
];
