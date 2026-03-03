"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cn = cn;
exports.cosineSimilarity = cosineSimilarity;
exports.toWhatsAppJid = toWhatsAppJid;
exports.normalizePhone = normalizePhone;
exports.generatePhoneVariations = generatePhoneVariations;
/**
 * Concatena classNames (versão simplificada sem clsx/twMerge — não necessários no backend)
 */
function cn(...inputs) {
    return inputs.filter(Boolean).join(' ');
}
/**
 * Calcula a similaridade de cosseno entre dois vetores
 */
function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0)
        return 0;
    return dotProduct / denominator;
}
/**
 * Converte um número de telefone para o formato JID do WhatsApp
 */
function toWhatsAppJid(phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.includes('@'))
        return cleanPhone;
    return `${cleanPhone}@s.whatsapp.net`;
}
/**
 * Normaliza telefone removendo caracteres não-numéricos
 */
function normalizePhone(phone) {
    return phone.replace(/\D/g, '');
}
/**
 * Gera variações válidas de número de telefone brasileiro
 */
function generatePhoneVariations(phone) {
    const cleanPhone = normalizePhone(phone);
    const variations = new Set();
    if (!cleanPhone)
        return [];
    variations.add(cleanPhone);
    if (cleanPhone.startsWith('55')) {
        variations.add(cleanPhone.slice(2));
    }
    else {
        variations.add('55' + cleanPhone);
    }
    const add9thDigitVars = (p) => {
        if (p.startsWith('55')) {
            if (p.length === 13) {
                variations.add(p.slice(0, 4) + p.slice(5));
            }
            else if (p.length === 12) {
                variations.add(p.slice(0, 4) + '9' + p.slice(4));
            }
        }
        else {
            if (p.length === 11) {
                variations.add(p.slice(0, 2) + p.slice(3));
            }
            else if (p.length === 10) {
                variations.add(p.slice(0, 2) + '9' + p.slice(2));
            }
        }
    };
    Array.from(variations).forEach(add9thDigitVars);
    return Array.from(variations);
}
//# sourceMappingURL=utils.js.map