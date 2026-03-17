import OpenAI from 'openai';
import { AgentContext } from './types';
import { agentLogger } from '../lib/logger';
import { getChatHistory } from '../lib/chat-history';

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
    const toolsConfig: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as any,
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
                agentLogger.warn(`Tentativa ${attempts} falhou:`, error);
                if (attempts >= maxAttempts) throw error;
                await new Promise(res => setTimeout(res, 1000 * attempts));
            }
        }
        throw new Error('Máximo de tentativas atingido');
    };

    const MAX_TOOL_ROUNDS = 5;

    try {
        // 1. Carregar histórico recente (últimas 15 mensagens)
        const history = await getChatHistory(context.userPhone, 15);
        
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt }
        ];
        
        // 2. Adicionar histórico (evitando duplicar a mensagem atual se ela já foi salva no webhook)
        const currentMsgText = typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage);
        
        for (const h of history) {
            // Se a última mensagem do histórico for idêntica à atual, ignoramos para não duplicar
            if (h.role === 'user' && h.content === currentMsgText && h === history[history.length - 1]) {
                continue;
            }
            messages.push({ role: h.role as 'user' | 'assistant' | 'system', content: h.content });
        }

        // 3. Adicionar a mensagem atual do usuário
        messages.push({ role: 'user', content: currentMsgText });

        let round = 0;
        let accumulatedContent = '';

        while (round < MAX_TOOL_ROUNDS) {
            round++;
            const aiTimer = agentLogger.timer(`OpenAI request (round ${round})`);
            const response = await callOpenAI(messages, toolsConfig);
            const usage = response.usage;
            aiTimer.end(usage ? `tokens: ${usage.prompt_tokens}→${usage.completion_tokens} (total: ${usage.total_tokens})` : undefined);

            const choice = response.choices[0];
            const message = choice.message;

            if (message.content) {
                accumulatedContent += (accumulatedContent ? ' ||| ' : '') + message.content;
            }

            // Se não tem tool calls, retornar o conteúdo acumulado
            if (!message.tool_calls || message.tool_calls.length === 0) {
                return accumulatedContent.trim();
            }

            // Processar tool calls
            messages.push(message);

            for (const toolCall of message.tool_calls) {
                if (toolCall.type === 'function') {
                    const toolName = toolCall.function.name;
                    agentLogger.info(`🛠️ [Round ${round}] Chamando tool: ${toolName}`, toolCall.function.arguments);
                    const toolTimer = agentLogger.timer(`Tool ${toolName}`);
                    let toolResult = '';

                    try {
                        const toolArgs = JSON.parse(toolCall.function.arguments);
                        const tool = tools.find(t => t.name === toolName);

                        if (tool) {
                            try {
                                toolResult = await tool.function(toolArgs);
                                toolTimer.end();
                                agentLogger.debug(`Tool ${toolName} output: ${toolResult.substring(0, 150)}${toolResult.length > 150 ? '...' : ''}`);
                            } catch (toolExecError) {
                                agentLogger.error(`Erro ao executar tool ${toolName}:`, toolExecError);
                                toolTimer.end('ERRO');
                                toolResult = JSON.stringify({
                                    status: 'error',
                                    message: `Erro ao executar ferramenta ${toolName}: ${toolExecError instanceof Error ? toolExecError.message : String(toolExecError)}`
                                });
                            }
                        } else {
                            toolResult = JSON.stringify({ status: 'error', message: `Ferramenta ${toolName} não encontrada.` });
                        }
                    } catch (jsonError) {
                        agentLogger.error(`Erro ao parsear argumentos da tool ${toolName}:`, jsonError);
                        toolResult = JSON.stringify({ status: 'error', message: 'Erro ao processar argumentos da ferramenta (JSON inválido).' });
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: toolResult,
                    });
                }
            }
        }

        // Se chegou aqui, atingiu o limite de rodadas — forçar resposta final sem tools
        agentLogger.warn(`⚠️ Atingiu limite de ${MAX_TOOL_ROUNDS} rodadas de tool calls. Forçando resposta final.`);
        const finalTimer = agentLogger.timer('OpenAI final (sem tools)');
        const finalResponse = await callOpenAI(messages);
        const usage = finalResponse.usage;
        finalTimer.end(usage ? `tokens: ${usage.prompt_tokens}→${usage.completion_tokens}` : undefined);
        return finalResponse.choices[0].message.content || '';
    } catch (error: unknown) {
        agentLogger.error('❌ Erro ao executar agente:', error);
        return 'Desculpe, tive um problema técnico. Tente novamente mais tarde.';
    }
}
