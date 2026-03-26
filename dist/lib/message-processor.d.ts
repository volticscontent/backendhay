export interface IncomingMessagePayload {
    event: string;
    instance: string;
    data: any;
}
/**
 * Processa mensagens recebidas (via Webhook ou WebSocket)
 */
export declare function processIncomingMessage(payload: IncomingMessagePayload): Promise<{
    status: string;
    messageId?: undefined;
    userPhone?: undefined;
} | {
    status: string;
    messageId: string;
    userPhone?: undefined;
} | {
    status: string;
    userPhone: any;
    messageId?: undefined;
}>;
//# sourceMappingURL=message-processor.d.ts.map