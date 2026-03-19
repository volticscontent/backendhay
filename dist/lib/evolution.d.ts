export declare function evolutionSendTextMessage(jid: string, text: string): Promise<unknown>;
export declare function evolutionSendMediaMessage(jid: string, mediaUrl: string, mediatype: 'image' | 'video' | 'audio' | 'document', caption: string, fileName: string, mimetype: string): Promise<unknown>;
export declare function evolutionFindMessages(jid: string, limit?: number): Promise<{
    messages?: {
        records?: Array<{
            key: {
                fromMe: boolean;
            };
            message: unknown;
        }>;
    };
}>;
export declare function evolutionFetchInstances(): Promise<unknown>;
export declare function evolutionGetConnectionState(): Promise<any>;
export declare function evolutionGetProfilePic(jid: string): Promise<unknown>;
/**
 * Baixa a mídia de uma mensagem em base64 usando o endpoint getBase64FromMediaMessage.
 * Útil quando o webhook não envia o base64 inline.
 */
export declare function evolutionGetBase64FromMedia(messageId: string, convertToMp4?: boolean): Promise<{
    base64: string;
    mimetype: string;
} | null>;
//# sourceMappingURL=evolution.d.ts.map