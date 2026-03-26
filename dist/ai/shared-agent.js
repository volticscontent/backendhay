"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareAgentContext = prepareAgentContext;
exports.getSharedTools = getSharedTools;
const server_tools_1 = require("./server-tools");
const knowledge_base_1 = require("./knowledge-base");
const logger_1 = require("../lib/logger");
async function prepareAgentContext(context) {
    let userDataJson = "{}";
    try {
        userDataJson = await (0, server_tools_1.getUser)(context.userPhone);
    }
    catch (error) {
        logger_1.agentLogger.warn("Error fetching user data:", error);
    }
    let userData = "Não encontrado";
    try {
        const parsed = JSON.parse(userDataJson);
        if (parsed.status !== 'error' && parsed.status !== 'not_found') {
            const allowedKeys = [
                'telefone', 'nome_completo', 'email', 'situacao', 'qualificacao',
                'observacoes', 'faturamento_mensal', 'tem_divida', 'tipo_negocio',
                'possui_socio', 'sexo', 'cnpj', 'razao_social', 'tipo_divida',
                'valor_divida_federal'
            ];
            userData = Object.entries(parsed)
                .filter(([k]) => allowedKeys.includes(k))
                .map(([k, v]) => `${k} = ${v}`)
                .join('\n');
        }
    }
    catch { }
    let mediaList = "Nenhuma mídia disponível.";
    let dynamicContext = "";
    try {
        [mediaList, dynamicContext] = await Promise.all([(0, server_tools_1.getAvailableMedia)(), (0, knowledge_base_1.getDynamicContext)()]);
    }
    catch (e) {
        logger_1.agentLogger.warn("Error fetching media/context:", e);
    }
    const attendantWarning = context.attendantRequestedReason
        ? `\n[ATENÇÃO: ATENDENTE HUMANO SOLICITADO]\nO cliente solicitou atendimento humano pelo seguinte motivo: "${context.attendantRequestedReason}". O humano já foi notificado e responderá em breve. Enquanto o humano não chega, mantenha o diálogo e tente ir adiantando as informações ou acolhendo o cliente de forma empática avisando que a equipe humana está a caminho.\n`
        : '';
    const outOfHoursWarning = context.outOfHours
        ? `\n[ATENÇÃO: HUMANO INDISPONÍVEL]\nNeste exato momento, o time humano da Haylander Martins Contabilidade está fora do horário comercial. VOCÊ deve continuar o atendimento normalmente. Avisar o cliente de forma amigável que o time humano responderá assim que retornar, mas que você pode adiantar o caso agora.\n`
        : '';
    const currentDate = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return { userData, mediaList, dynamicContext, attendantWarning, outOfHoursWarning, currentDate };
}
function getSharedTools(context) {
    return [
        {
            name: 'context_retrieve',
            description: 'Buscar o contexto recente da conversa do cliente (Evolution API).',
            parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Quantidade de mensagens a buscar (padrão 30).' } } },
            function: async (args) => await (0, server_tools_1.contextRetrieve)(context.userId, typeof args.limit === 'number' ? args.limit : 30)
        },
        {
            name: 'enviar_midia',
            description: 'Enviar um arquivo de mídia (PDF, Vídeo, Áudio).',
            parameters: { type: 'object', properties: { key: { type: 'string', description: 'A chave (ID) do arquivo de mídia.' } }, required: ['key'] },
            function: async (args) => await (0, server_tools_1.sendMedia)(context.userPhone, args.key)
        },
        {
            name: 'update_user',
            description: 'Atualizar dados do usuário. OBRIGATÓRIO informar observacoes com resumo e motivo_qualificacao ao qualificar/desqualificar.',
            parameters: {
                type: 'object',
                properties: {
                    situacao: { type: 'string', enum: ['nao_respondido', 'desqualificado', 'qualificado', 'cliente', 'atendimento_humano', 'Ativo'] },
                    qualificacao: { type: 'string', enum: ['ICP', 'MQL', 'SQL'] },
                    motivo_qualificacao: { type: 'string', description: 'Por que foi qualificado ou desqualificado?' },
                    observacoes: { type: 'string', description: 'Relato do contexto, escolhas (ex: autonomo) e histórico do lead para os humanos.' },
                    faturamento_mensal: { type: 'string' },
                    tipo_negocio: { type: 'string' },
                    tem_divida: { type: 'boolean' },
                    tipo_divida: { type: 'string' },
                    valor_divida_federal: { type: 'string' },
                    possui_socio: { type: 'boolean' },
                    cpf: { type: 'string' },
                    cnpj: { type: 'string' },
                    razao_social: { type: 'string' },
                    email: { type: 'string' },
                    nome_completo: { type: 'string' },
                    sexo: { type: 'string' }
                },
                additionalProperties: true
            },
            function: async (args) => {
                const result = await (0, server_tools_1.updateUser)({ telefone: context.userPhone, ...args });
                if (args.qualificacao) {
                    await (0, server_tools_1.setAgentRouting)(context.userPhone, 'vendedor');
                    logger_1.agentLogger.info(`🔀 Roteamento ativado: ${context.userPhone} → Vendedor (qualificação: ${args.qualificacao})`);
                }
                return result;
            }
        },
        {
            name: 'listar_tabelas_e_campos',
            description: 'Retorna a lista completa de todas as tabelas e os campos que você tem permissão para atualizar usando a ferramenta update_user. Use isto se quiser saber exatamente quais variáveis pode enviar e atualizar.',
            parameters: { type: 'object', properties: {} },
            function: async () => await (0, server_tools_1.getUpdatableFields)()
        },
        {
            name: 'chamar_atendente',
            description: 'Transferir o atendimento para um atendente humano. Forneça um resumo detalhado da necessidade no campo reason.',
            parameters: { type: 'object', properties: { reason: { type: 'string', description: 'Resumo detalhado: O que o cliente quer, qual a dor dele e o que já foi conversado.' } }, required: ['reason'] },
            function: async (args) => await (0, server_tools_1.callAttendant)(context.userPhone, args.reason)
        },
        {
            name: 'interpreter',
            description: 'Ferramenta de memória compartilhada (post/get).',
            parameters: { type: 'object', properties: { action: { type: 'string', enum: ['post', 'get'] }, text: { type: 'string' }, category: { type: 'string', enum: ['qualificacao', 'vendas', 'atendimento'] } }, required: ['action', 'text'] },
            function: async (args) => await (0, server_tools_1.interpreter)(context.userPhone, args.action, args.text, args.category)
        },
        {
            name: 'select_User',
            description: 'Buscar informações atualizadas do lead no banco de dados.',
            parameters: { type: 'object', properties: {} },
            function: async () => await (0, server_tools_1.getUser)(context.userPhone)
        }
    ];
}
//# sourceMappingURL=shared-agent.js.map