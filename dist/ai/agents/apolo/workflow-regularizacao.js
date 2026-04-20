"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegularizacaoTools = exports.REGULARIZACAO_RULES = void 0;
const server_tools_1 = require("../../server-tools");
const db_1 = __importDefault(require("../../../lib/db"));
const regularizacao_system_1 = require("../../regularizacao-system");
async function processMessageSegments(phone, segments, sender) {
    for (const segment of segments) {
        if (segment.delay && segment.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, segment.delay));
        }
        await sender(segment);
    }
}
async function resolveUserCnpjAndProcuracaoStatus(userData) {
    if (!userData?.id) {
        return { ok: false, message: 'Usuário sem identificação interna. Atualize o cadastro antes da consulta.' };
    }
    let cnpj = userData.cnpj;
    if (!cnpj) {
        const resEmp = await db_1.default.query('SELECT cnpj FROM leads_empresarial WHERE lead_id = $1 LIMIT 1', [userData.id]);
        if (resEmp.rows.length > 0)
            cnpj = resEmp.rows[0].cnpj;
    }
    if (!cnpj) {
        return { ok: false, message: 'CNPJ não localizado. Peça ao cliente para confirmar os dados cadastrais.' };
    }
    const salesRes = await db_1.default.query('SELECT procuracao, procuracao_ativa FROM leads_vendas WHERE lead_id = $1 LIMIT 1', [userData.id]);
    const salesRow = salesRes.rows[0] || {};
    const hasFormalProcuracao = Boolean(salesRow.procuracao) || Boolean(salesRow.procuracao_ativa);
    const hasTrackedCompletion = await (0, server_tools_1.checkProcuracaoStatus)(userData.id);
    if (!hasFormalProcuracao && !hasTrackedCompletion) {
        return {
            ok: false,
            message: 'Consulta Serpro bloqueada: primeiro confirme a Procuração e-CAC (Opção A) e valide com verificar_procuracao_status/verificar_serpro_pos_ecac.'
        };
    }
    return { ok: true, cnpj };
}
exports.REGULARIZACAO_RULES = `
# Regras de Regularização e Conformidade Serpro
### Fluxo de Regularização (Dívidas, PGMEI, Abertura/Baixa)
Se o cliente mencionar dívidas, pendências, boleto atrasado ou regularização:
1. **NÃO ENVIE O FORMULÁRIO AINDA.**
2. Use a tool 'iniciar_fluxo_regularizacao' para introduzir o processo de forma natural.
3. Aguarde a resposta do cliente (Opção A - Procuração vs Opção B - Acesso Direto).
4. Se Opção A (Procuração): Use 'enviar_processo_autonomo'.
5. Após a conclusão da Procuração, use 'verificar_serpro_pos_ecac' IMEDIATAMENTE.
   - Sucesso -> chame 'marcar_procuracao_concluida'.
   - Falha -> peça print do e-CAC.

- **MEI Excluído ou Desenquadrado:**
  Ofereça duas opções claras: 
  Opção 1 (Procuração): Regularizar agora e aguardar (valor menor, sem Gov).
  Opção 2 (Acesso Direto): Baixar atual e abrir novo (valor maior, exige Gov).

### CONSULTAS SERPRO (PGMEI / SITFIS) - REGRAS ESTRITAS
- **NÃO FAÇA** consultas ao Serpro (PGMEI, Dívida Ativa, Situação Fiscal) sem ANTES garantir que a Procuração foi assinada e confirmada via Serpro (com a tool verificar_procuracao_status ou fluxo explícito).
- O uso desenfreado gasta recursos e expõe nossos IPs. 
- Explicite ao cliente que: "Para consultarmos exatamente as pendências do seu MEI ou sua situação fiscal de forma segura, o primeiro passo é você nos enviar a Procuração (via Opção A)."
- Somente DEPOIS disso, use 'consultar_divida_ativa_serpro' ou 'consultar_situacao_fiscal_serpro'.
`;
const getRegularizacaoTools = (context) => [
    {
        name: 'iniciar_fluxo_regularizacao', description: 'Inicia o fluxo de regularização fiscal aprimorado.', parameters: { type: 'object', properties: {} },
        function: async () => { try {
            const segments = (0, regularizacao_system_1.createRegularizacaoMessageSegments)();
            await processMessageSegments(context.userPhone, segments, (segment) => (0, server_tools_1.sendMessageSegment)(context.userPhone, segment));
            return JSON.stringify({ status: "success", message: "Fluxo de regularização iniciado" });
        }
        catch (error) {
            return JSON.stringify({ status: "error", message: String(error) });
        } }
    },
    {
        name: 'enviar_processo_autonomo', description: 'Envia o processo autônomo de procuração e-CAC regularização.', parameters: { type: 'object', properties: {} },
        function: async () => { try {
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
            return JSON.stringify({ status: "success" });
        }
        catch (error) {
            return JSON.stringify({ status: "error", message: String(error) });
        } }
    },
    {
        name: 'verificar_procuracao_status', description: 'Verifica se o cliente já concluiu a procuração.', parameters: { type: 'object', properties: {} },
        function: async () => { try {
            const ud = await (0, server_tools_1.getUser)(context.userPhone);
            if (!ud)
                return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
            const p = JSON.parse(ud);
            if (p.status === 'error' || p.status === 'not_found')
                return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
            const completed = await (0, server_tools_1.checkProcuracaoStatus)(p.id);
            return JSON.stringify({ status: "success", completed, message: completed ? "Procuração já concluída" : "Procuração pendente" });
        }
        catch (error) {
            return JSON.stringify({ status: "error", message: String(error) });
        } }
    },
    {
        name: 'marcar_procuracao_concluida', description: 'Marca a procuração como concluída.', parameters: { type: 'object', properties: {} },
        function: async () => { try {
            const ud = await (0, server_tools_1.getUser)(context.userPhone);
            if (!ud)
                return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
            const p = JSON.parse(ud);
            if (p.status === 'error' || p.status === 'not_found')
                return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
            await (0, server_tools_1.markProcuracaoCompleted)(p.id);
            return JSON.stringify({ status: "success" });
        }
        catch (error) {
            return JSON.stringify({ status: "error", message: String(error) });
        } }
    },
    {
        name: 'verificar_serpro_pos_ecac', description: 'Verifica no Serpro se a procuração ou cadastro do cliente reflete no sistema governamental após ele afirmar conclusão no e-CAC.', parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
                let cnpj = p.cnpj;
                if (!cnpj && p.id) {
                    const resEmp = await db_1.default.query('SELECT cnpj FROM leads_empresarial WHERE lead_id = $1 LIMIT 1', [p.id]);
                    if (resEmp.rows.length > 0)
                        cnpj = resEmp.rows[0].cnpj;
                }
                if (!cnpj)
                    return JSON.stringify({ status: "error", message: "CNPJ não cadastrado. Peça o print." });
                try {
                    const serproResult = await (0, server_tools_1.consultarProcuracaoSerpro)(cnpj);
                    const parsedResult = JSON.parse(serproResult);
                    if (parsedResult.status === 'error') {
                        if (parsedResult.error_type === 'procuracao_ausente') {
                            return JSON.stringify({ status: "error", message: "Procuração não detectada no sistema Serpro. O cliente pode ter esquecido de assinar ou salvar." });
                        }
                        return JSON.stringify({ status: "error", message: `Erro na comunicação com o Serpro: ${parsedResult.message}` });
                    }
                    return JSON.stringify({ status: "success", message: "Procuração validada com sucesso via Serpro.", serpro_dados: parsedResult });
                }
                catch (serproError) {
                    return JSON.stringify({ status: "error", message: "Erro técnico na comunicação com Serpro. Peça um print do e-CAC." });
                }
            }
            catch (error) {
                return JSON.stringify({ status: "error", message: String(error) });
            }
        }
    },
    {
        name: 'consultar_divida_ativa_serpro', description: 'Consulta débitos em Dívida Ativa da União via Serpro (somente após Procuração confirmada).', parameters: { type: 'object', properties: { ano: { type: 'string', description: 'Ano opcional (ex: 2024). Padrão é ano atual.' } } },
        function: async (args) => {
            try {
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: "error", error_type: "procuracao_obrigatoria", message: gate.message || "Procuração obrigatória para consulta Serpro." });
                }
                const result = await (0, server_tools_1.checkCnpjSerpro)(gate.cnpj, 'DIVIDA_ATIVA', { ano: args.ano || new Date().getFullYear().toString() });
                return result;
            }
            catch (error) {
                return JSON.stringify({ status: "error", message: String(error) });
            }
        }
    },
    {
        name: 'consultar_situacao_fiscal_serpro', description: 'Solicita relatório de Situação Fiscal Completa via Serpro (somente após Procuração confirmada).', parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                const ud = await (0, server_tools_1.getUser)(context.userPhone);
                if (!ud)
                    return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
                const p = JSON.parse(ud);
                if (p.status === 'error' || p.status === 'not_found')
                    return JSON.stringify({ status: "error", message: "Usuário não encontrado" });
                const gate = await resolveUserCnpjAndProcuracaoStatus(p);
                if (!gate.ok || !gate.cnpj) {
                    return JSON.stringify({ status: "error", error_type: "procuracao_obrigatoria", message: gate.message || "Procuração obrigatória para consulta Serpro." });
                }
                const result = await (0, server_tools_1.checkCnpjSerpro)(gate.cnpj, 'SIT_FISCAL');
                return result;
            }
            catch (error) {
                return JSON.stringify({ status: "error", message: String(error) });
            }
        }
    }
];
exports.getRegularizacaoTools = getRegularizacaoTools;
//# sourceMappingURL=workflow-regularizacao.js.map