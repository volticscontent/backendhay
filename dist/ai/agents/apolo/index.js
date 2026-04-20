"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runApoloAgent = runApoloAgent;
const openai_client_1 = require("../../openai-client");
const shared_agent_1 = require("../../shared-agent");
const prompt_1 = require("./prompt");
const workflow_comercial_1 = require("./workflow-comercial");
const workflow_regularizacao_1 = require("./workflow-regularizacao");
const workflow_suporte_1 = require("./workflow-suporte");
const server_tools_1 = require("../../server-tools"); // needed for apolo fallback if needed, but not strictly if didn't define in rules. Oh wait, sending form!
const APOLO_PROMPT_TEMPLATE = `
${prompt_1.BASE_PROMPT}

${workflow_comercial_1.COMERCIAL_RULES}

${workflow_regularizacao_1.REGULARIZACAO_RULES}

${workflow_suporte_1.SUPORTE_RULES}
`;
async function runApoloAgent(message, context) {
    const sharedCtx = await (0, shared_agent_1.prepareAgentContext)(context);
    const systemPrompt = APOLO_PROMPT_TEMPLATE
        .replace('{{USER_DATA}}', sharedCtx.userData)
        .replace('{{USER_NAME}}', context.userName || 'Cliente')
        .replace('{{MEDIA_LIST}}', sharedCtx.mediaList)
        .replace('{{DYNAMIC_CONTEXT}}', sharedCtx.dynamicContext)
        .replace('{{ATTENDANT_WARNING}}', sharedCtx.attendantWarning)
        .replace('{{OUT_OF_HOURS_WARNING}}', sharedCtx.outOfHoursWarning)
        .replace('{{CURRENT_DATE}}', sharedCtx.currentDate);
    // Some tools might be common or slightly customized. We bring them together:
    const customTools = [
        ...(0, workflow_comercial_1.getComercialTools)(context),
        ...(0, workflow_regularizacao_1.getRegularizacaoTools)(context),
        ...(0, workflow_suporte_1.getSuporteTools)(context),
        // Adicionando a tool perdida do apolo
        {
            name: 'enviar_formulario',
            description: 'Enviar link do formulário seguro.',
            parameters: { type: 'object', properties: { observacao: { type: 'string' } } },
            function: async (args) => await (0, server_tools_1.sendForm)(context.userPhone, args.observacao)
        }
    ];
    const tools = [...(0, shared_agent_1.getSharedTools)(context), ...customTools];
    return (0, openai_client_1.runAgent)(systemPrompt, message, context, tools);
}
//# sourceMappingURL=index.js.map