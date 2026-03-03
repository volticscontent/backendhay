/**
 * Busca histórico de chat do banco de dados
 */
export declare function getChatHistory(phone: string, limit?: number): Promise<{
    role: 'user' | 'system' | 'assistant';
    content: string;
}[]>;
/**
 * Adiciona mensagem ao histórico de chat
 */
export declare function addToHistory(phone: string, role: 'user' | 'assistant' | 'system', content: string | Array<{
    type: string;
    text?: string;
    image_url?: {
        url: string;
    };
}>): Promise<void>;
//# sourceMappingURL=chat-history.d.ts.map