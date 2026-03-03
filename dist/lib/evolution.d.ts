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
export declare function evolutionGetProfilePic(jid: string): Promise<unknown>;
//# sourceMappingURL=evolution.d.ts.map