/**
 * Concatena classNames (versão simplificada sem clsx/twMerge — não necessários no backend)
 */
export declare function cn(...inputs: (string | undefined | null | false)[]): string;
/**
 * Calcula a similaridade de cosseno entre dois vetores
 */
export declare function cosineSimilarity(a: number[], b: number[]): number;
/**
 * Converte um número de telefone para o formato JID do WhatsApp
 */
export declare function toWhatsAppJid(phone: string): string;
/**
 * Normaliza telefone removendo caracteres não-numéricos
 */
export declare function normalizePhone(phone: string): string;
/**
 * Gera variações válidas de número de telefone brasileiro
 */
export declare function generatePhoneVariations(phone: string): string[];
//# sourceMappingURL=utils.d.ts.map