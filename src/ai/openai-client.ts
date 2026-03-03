import OpenAI from 'openai';
import { AgentContext } from './types';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
});

export type ToolParameters = Record<string, unknown>;

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: ToolParameters;
    function: (args: ToolParameters) => Promise<string>;
}

export async function runAgent(
    systemPrompt: string,
    userMessage: string | Array<OpenAI.Chat.Completions.ChatCompletionContentPart>,
    context: AgentContext,
    tools: ToolDefinition[]
): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...context.history.map(h => ({ role: h.role, content: h.content } as OpenAI.Chat.Completions.ChatCompletionMessageParam)),
        { role: 'user', content: userMessage }
    ];

    const toolsConfig: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        },
    }));

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const callOpenAI = async (msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[], toolsList?: OpenAI.Chat.Completions.ChatCompletionTool[]) => {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            try {
                return await openai.chat.completions.create({
                    model,
                    messages: msgs,
                    tools: toolsList && toolsList.length > 0 ? toolsList : undefined,
                    tool_choice: toolsList && toolsList.length > 0 ? 'auto' : undefined,
                });
            } catch (error) {
                attempts++;
                console.warn(`[OpenAI] Tentativa ${attempts} falhou:`, error);
                if (attempts >= maxAttempts) throw error;
                await new Promise(res => setTimeout(res, 1000 * attempts));
            }
        }
        throw new Error('Máximo de tentativas atingido');
    };

    try {
        const response = await callOpenAI(messages, toolsConfig);

        const choice = response.choices[0];
        const message = choice.message;

        if (message.tool_calls) {
            messages.push(message);

            for (const toolCall of message.tool_calls) {
                if (toolCall.type === 'function') {
                    const toolName = toolCall.function.name;
                    console.log(`[Agent] 🛠️ Chamando tool: ${toolName}`, toolCall.function.arguments);
                    let toolResult = '';

                    try {
                        const toolArgs = JSON.parse(toolCall.function.arguments);
                        const tool = tools.find(t => t.name === toolName);

                        if (tool) {
                            try {
                                toolResult = await tool.function(toolArgs);
                                console.log(`[Agent] ✅ Tool ${toolName} output:`, toolResult.substring(0, 100) + (toolResult.length > 100 ? '...' : ''));
                            } catch (toolExecError) {
                                console.error(`Erro ao executar tool ${toolName}:`, toolExecError);
                                toolResult = JSON.stringify({
                                    status: 'error',
                                    message: `Erro ao executar ferramenta ${toolName}: ${toolExecError instanceof Error ? toolExecError.message : String(toolExecError)}`
                                });
                            }
                        } else {
                            toolResult = JSON.stringify({ status: 'error', message: `Ferramenta ${toolName} não encontrada.` });
                        }
                    } catch (jsonError) {
                        console.error(`Erro ao parsear argumentos da tool ${toolName}:`, jsonError);
                        toolResult = JSON.stringify({ status: 'error', message: 'Erro ao processar argumentos da ferramenta (JSON inválido).' });
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: toolResult,
                    });
                }
            }

            const secondResponse = await callOpenAI(messages);
            return secondResponse.choices[0].message.content || '';
        }

        return message.content || '';
    } catch (error: unknown) {
        console.error('[Agent] Erro ao executar agente:', error);
        return 'Desculpe, tive um problema técnico. Tente novamente mais tarde.';
    }
}
