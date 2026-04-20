import { AgentContext, AgentMessage } from '../../types';
import { runAgent, ToolDefinition } from '../../openai-client';
import { prepareAgentContext, getSharedTools } from '../../shared-agent';
import { BASE_PROMPT } from './prompt';
import { COMERCIAL_RULES, getComercialTools } from './workflow-comercial';
import { REGULARIZACAO_RULES, getRegularizacaoTools } from './workflow-regularizacao';
import { SUPORTE_RULES, getSuporteTools } from './workflow-suporte';
import { sendForm } from '../../server-tools'; // needed for apolo fallback if needed, but not strictly if didn't define in rules. Oh wait, sending form!

const APOLO_PROMPT_TEMPLATE = `
${BASE_PROMPT}

${COMERCIAL_RULES}

${REGULARIZACAO_RULES}

${SUPORTE_RULES}
`;

export async function runApoloAgent(message: AgentMessage, context: AgentContext) {
    const sharedCtx = await prepareAgentContext(context);

    const systemPrompt = APOLO_PROMPT_TEMPLATE
        .replace('{{USER_DATA}}', sharedCtx.userData)
        .replace('{{USER_NAME}}', context.userName || 'Cliente')
        .replace('{{MEDIA_LIST}}', sharedCtx.mediaList)
        .replace('{{DYNAMIC_CONTEXT}}', sharedCtx.dynamicContext)
        .replace('{{ATTENDANT_WARNING}}', sharedCtx.attendantWarning)
        .replace('{{OUT_OF_HOURS_WARNING}}', sharedCtx.outOfHoursWarning)
        .replace('{{CURRENT_DATE}}', sharedCtx.currentDate);

    // Some tools might be common or slightly customized. We bring them together:
    const customTools: ToolDefinition[] = [
        ...getComercialTools(context),
        ...getRegularizacaoTools(context),
        ...getSuporteTools(context),
        // Adicionando a tool perdida do apolo
        {
            name: 'enviar_formulario',
            description: 'Enviar link do formulário seguro.',
            parameters: { type: 'object', properties: { observacao: { type: 'string' } } },
            function: async (args: any) => await sendForm(context.userPhone, args.observacao)
        }
    ];

    const tools = [...getSharedTools(context), ...customTools];

    return runAgent(systemPrompt, message, context, tools);
}
