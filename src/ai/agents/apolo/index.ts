import { AgentContext, AgentMessage } from '../../types';
import { runAgent, ToolDefinition } from '../../openai-client';
import { prepareAgentContext, getSharedTools } from '../../shared-agent';
import { BASE_PROMPT } from './prompt';
import { COMERCIAL_RULES, getComercialTools } from './workflow-comercial';
import { REGULARIZACAO_RULES, getRegularizacaoTools } from './workflow-regularizacao';
import { SUPORTE_RULES, getSuporteTools } from './workflow-suporte';
import { query } from '../../../lib/db';

const DEFAULT_ECAC_TUTORIAL_LINK = 'https://www.instagram.com/reel/DWquc43Cdnm/?igsh=OXlzc2ZzNDVvaHU5';

async function getEcacTutorialLink(): Promise<string> {
    try {
        const { rows } = await query('SELECT value FROM system_settings WHERE key = $1', ['link_ecac_tutorial']);
        return (rows[0]?.value as string) || DEFAULT_ECAC_TUTORIAL_LINK;
    } catch {
        return DEFAULT_ECAC_TUTORIAL_LINK;
    }
}

const APOLO_PROMPT_TEMPLATE = `
${BASE_PROMPT}

${COMERCIAL_RULES}

${REGULARIZACAO_RULES}

${SUPORTE_RULES}
`;

export async function runApoloAgent(message: AgentMessage, context: AgentContext) {
    const [sharedCtx, ecacTutorialLink] = await Promise.all([
        prepareAgentContext(context),
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
    const customTools: ToolDefinition[] = [
        ...getComercialTools(context),
        ...getRegularizacaoTools(context),
        ...getSuporteTools(context),
        // Formulário web externo DESCONTINUADO: a coleta de dados agora é 100% conversacional
        // (ver workflow-regularizacao: concluir_cadastro_fechamento). A tool 'enviar_formulario'
        // foi removida para o modelo nunca mais enviar o link do Vercel.
    ];

    const tools = [...getSharedTools(context), ...customTools];

    return runAgent(systemPrompt, message, context, tools);
}
