export declare function evolutionSendTextMessage(jid: string, text: string): Promise<unknown>;
export declare function evolutionSendMediaMessage(jid: string, mediaUrl: string, mediatype: 'image' | 'video' | 'audio' | 'document', caption: string, fileName: string, mimetype: string): Promise<unknown>;
export declare function evolutionFindMessages(jid: string, limit?: number, page?: number): Promise<{
    messages?: {
        records?: Array<{
            key: {
                fromMe: boolean;
            };
            message: unknown;
        }>;
    };
}>;
export declare function evolutionSendWhatsAppAudio(jid: string, audio: string): Promise<unknown>;
export declare function evolutionGetBase64FromMediaMessage(message: unknown): Promise<{
    base64: string;
    mimetype: string;
} | null>;
export declare function evolutionFetchInstances(): Promise<unknown>;
export declare function evolutionGetConnectionState(): Promise<any>;
export declare function evolutionConnectInstance(): Promise<unknown>;
export declare function evolutionGetProfilePic(jid: string): Promise<unknown>;
/**
 * Baixa a mídia de uma mensagem em base64 usando o endpoint getBase64FromMediaMessage.
 * Útil quando o webhook não envia o base64 inline.
 */
export declare function evolutionGetBase64FromMedia(messageId: string, convertToMp4?: boolean): Promise<{
    base64: string;
    mimetype: string;
} | null>;
/**
 * Atualiza as configurações da instância (Always Online, Reject Call, etc.)
 * Rota padrão da v2: /settings/set/{instance}
 */
export declare function evolutionUpdateInstanceSettings(settings: {
    rejectCall?: boolean;
    msgCall?: string;
    groupsIgnore?: boolean;
    alwaysOnline?: boolean;
    readMessages?: boolean;
    readStatus?: boolean;
    syncFullHistory?: boolean;
    reconnectNetwork?: boolean;
    reconnectOnError?: boolean;
}): Promise<unknown>;
/**
 * Define as configurações de Webhook da instância
 */
export declare function evolutionSetWebhook(config: {
    enabled: boolean;
    url?: string;
    webhookByEvents?: boolean;
    webhookBase64?: boolean;
    events?: string[];
}): Promise<unknown>;
export declare function evolutionFindChats(): Promise<unknown[]>;
export declare function checkWhatsAppNumbers(numbers: string[]): Promise<Array<{
    exists: boolean;
    jid: string;
    number: string;
}>>;
export declare function toWhatsAppJid(phone: string): string;
//# sourceMappingURL=evolution.d.ts.map