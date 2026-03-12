import OpenAI from 'openai';
import { AgentContext } from './types';
export type ToolParameters = Record<string, unknown>;
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: ToolParameters;
    function: (args: ToolParameters) => Promise<string>;
}
export declare function runAgent(systemPrompt: string, userMessage: string | Array<OpenAI.Chat.Completions.ChatCompletionContentPart>, context: AgentContext, tools: ToolDefinition[]): Promise<string>;
//# sourceMappingURL=openai-client.d.ts.map