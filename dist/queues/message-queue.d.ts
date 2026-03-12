import { Queue, Worker } from 'bullmq';
/** Fila de envio de mensagens com delay */
export declare const messageQueue: Queue<any, any, string, any, any, string>;
/** Fila de follow-up (mensagens agendadas) */
export declare const followUpQueue: Queue<any, any, string, any, any, string>;
export interface MessageJobData {
    phone: string;
    messages: Array<{
        content: string;
        type: 'text' | 'media' | 'link';
        delay?: number;
        options?: Record<string, unknown>;
    }>;
    context?: string;
    leadId?: number;
}
export interface FollowUpJobData {
    phone: string;
    message: string;
    type: 'nudge' | 'follow_up' | 'reminder';
    metadata?: Record<string, unknown>;
}
/**
 * Substitui o sendToN8nHandler — enfileira mensagens para envio sequencial com delay
 */
export declare function enqueueMessages(payload: MessageJobData): Promise<string>;
/**
 * Agenda um follow-up (ex: lembrete de procuração, nudge de inatividade)
 */
export declare function scheduleFollowUp(phone: string, message: string, delayMs: number, type?: FollowUpJobData['type'], metadata?: Record<string, unknown>): Promise<string>;
/**
 * Cancela follow-ups pendentes de um telefone (quando o cliente responde)
 */
export declare function cancelPendingFollowUps(phone: string): Promise<void>;
/**
 * Worker que processa envio de mensagens sequenciais com delay
 * Substitui COMPLETAMENTE o n8n para envio de mensagens
 */
export declare function startMessageWorker(): Worker;
/**
 * Worker que processa follow-ups agendados
 */
export declare function startFollowUpWorker(): Worker;
//# sourceMappingURL=message-queue.d.ts.map