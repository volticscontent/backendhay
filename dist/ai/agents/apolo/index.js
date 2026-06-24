"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runApoloAgent = runApoloAgent;
const openai_client_1 = require("../../openai-client");
const shared_agent_1 = require("../../shared-agent");
const prompt_1 = require("./prompt");
const workflow_comercial_1 = require("./workflow-comercial");
const workflow_regularizacao_1 = require("./workflow-regularizacao");
const workflow_suporte_1 = require("./workflow-suporte");
const db_1 = require("../../../lib/db");
const DEFAULT_ECAC_TUTORIAL_LINK = 'https://www.instagram.com/reel/DWquc43Cdnm/?igsh=OXlzc2ZzNDVvaHU5';
async function getEcacTutorialLink() {
    try {
        const { rows } = await (0, db_1.query)('SELECT value FROM system_settings WHERE key = $1', ['link_ecac_tutorial']);
        return rows[0]?.value || DEFAULT_ECAC_TUTORIAL_LINK;
    }
    catch {
        return DEFAULT_ECAC_TUTORIAL_LINK;
    }
}
const APOLO_PROMPT_TEMPLATE = `
${prompt_1.BASE_PROMPT}

${workflow_comercial_1.COMERCIAL_RULES}

${workflow_regularizacao_1.REGULARIZACAO_RULES}

${workflow_suporte_1.SUPORTE_RULES}
`;
async function runApoloAgent(message, context) {
    const [sharedCtx, ecacTutorialLink] = await Promise.all([
        (0, shared_agent_1.prepareAgentContext)(context),
        getEcacTutorialLink(),
    ]);
    const systemPrompt = APOLO_PROMPT_TEMPLATE
        .replace('{{USER_DATA}}', sharedCtx.userData)
        .replace('{{USER_NAME}}', context.userName || 'Cliente')
        .replace('{{MEDIA_LIST}}', sharedCtx.mediaList)
        .replace('{{DYNAMIC_CONTEXT}}', sharedCtx.dynamicContext)
        .replace('{{ATTENDANT_WARNING}}', sharedCtx.attendantWarning)
        .replace('{{OUT_OF_HOURS_WARNING}}', sharedCtx.outOfHoursWarning)
        .replace('{{CURRENT_DATE}}', sharedCtx.currentDate)
        .replace('{{ECAC_TUTORIAL_LINK}}', ecacTutorialLink);
    // Some tools might be common or slightly customized. We bring them together:
    const customTools = [
        ...(0, workflow_comercial_1.getComercialTools)(context),
        ...(0, workflow_regularizacao_1.getRegularizacaoTools)(context),
        ...(0, workflow_suporte_1.getSuporteTools)(context),
        // Formulário web externo DESCONTINUADO: a coleta de dados agora é 100% conversacional
        // (ver workflow-regularizacao: concluir_cadastro_fechamento). A tool 'enviar_formulario'
        // foi removida para o modelo nunca mais enviar o link do Vercel.
    ];
    const tools = [...(0, shared_agent_1.getSharedTools)(context), ...customTools];
    return (0, openai_client_1.runAgent)(systemPrompt, message, context, tools);
}
//# sourceMappingURL=index.js.map