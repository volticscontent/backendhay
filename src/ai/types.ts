export type MultimodalItem =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export type AgentMessage = string | MultimodalItem[];

export interface AgentResponse {
    message: string;
    nextAction?: 'wait_user' | 'close_ticket' | 'escalate_human';
}

export interface AgentContext {
    userId: string;
    userName?: string;
    userPhone: string;
    history: { role: 'user' | 'system' | 'assistant'; content: string }[];
    attendantRequestedReason?: string;
}

export type AgentType = 'apolo' | 'vendedor' | 'atendente';
