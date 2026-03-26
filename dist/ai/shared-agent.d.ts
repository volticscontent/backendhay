import { AgentContext } from './types';
import { ToolDefinition } from './openai-client';
export interface SharedAgentContext {
    userData: string;
    mediaList: string;
    dynamicContext: string;
    attendantWarning: string;
    outOfHoursWarning: string;
    currentDate: string;
}
export declare function prepareAgentContext(context: AgentContext): Promise<SharedAgentContext>;
export declare function getSharedTools(context: AgentContext): ToolDefinition[];
//# sourceMappingURL=shared-agent.d.ts.map