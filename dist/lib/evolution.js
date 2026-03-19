"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.evolutionSendTextMessage = evolutionSendTextMessage;
exports.evolutionSendMediaMessage = evolutionSendMediaMessage;
exports.evolutionFindMessages = evolutionFindMessages;
exports.evolutionFetchInstances = evolutionFetchInstances;
exports.evolutionGetConnectionState = evolutionGetConnectionState;
exports.evolutionGetProfilePic = evolutionGetProfilePic;
exports.evolutionGetBase64FromMedia = evolutionGetBase64FromMedia;
const logger_1 = require("./logger");
const redis_1 = __importDefault(require("./redis"));
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || '';
const EVOLUTION_TIMEOUT_MS = parseInt(process.env.EVOLUTION_TIMEOUT_MS || '30000', 10);
async function evolutionRequest(path, method = 'GET', body) {
    const url = `${EVOLUTION_API_URL}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EVOLUTION_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_API_KEY,
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        if (!response.ok) {
            const errorText = await response.text();
            logger_1.evolutionLogger.error(`Evolution API Error ${response.status} em ${path}:`, errorText);
            throw new Error(`Evolution API Error ${response.status}: ${errorText}`);
        }
        // Registrar atividade global da instância no Redis ao ter sucesso em qualquer requisição
        redis_1.default.set('evolution:last_activity', Date.now().toString()).catch(() => { });
        return await response.json();
    }
    finally {
        clearTimeout(timeoutId);
    }
}
async function evolutionSendTextMessage(jid, text) {
    return evolutionRequest(`/message/sendText/${EVOLUTION_INSTANCE_NAME}`, 'POST', {
        number: jid,
        text,
    });
}
async function evolutionSendMediaMessage(jid, mediaUrl, mediatype, caption, fileName, mimetype) {
    return evolutionRequest(`/message/sendMedia/${EVOLUTION_INSTANCE_NAME}`, 'POST', {
        number: jid,
        media: mediaUrl,
        mediatype,
        caption,
        fileName,
        mimetype,
    });
}
async function evolutionFindMessages(jid, limit = 30) {
    return evolutionRequest(`/chat/findMessages/${EVOLUTION_INSTANCE_NAME}`, 'POST', {
        where: {
            key: {
                remoteJid: jid,
            },
        },
        limit,
    });
}
async function evolutionFetchInstances() {
    return evolutionRequest(`/instance/fetchInstances`, 'GET');
}
async function evolutionGetConnectionState() {
    return evolutionRequest(`/instance/connectionState/${EVOLUTION_INSTANCE_NAME}`, 'GET');
}
async function evolutionGetProfilePic(jid) {
    return evolutionRequest(`/chat/fetchProfilePictureUrl/${EVOLUTION_INSTANCE_NAME}`, 'POST', {
        number: jid,
    });
}
/**
 * Baixa a mídia de uma mensagem em base64 usando o endpoint getBase64FromMediaMessage.
 * Útil quando o webhook não envia o base64 inline.
 */
async function evolutionGetBase64FromMedia(messageId, convertToMp4 = false) {
    try {
        const result = await evolutionRequest(`/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE_NAME}`, 'POST', { message: { key: { id: messageId } }, convertToMp4 });
        if (result?.base64) {
            return { base64: result.base64, mimetype: result.mimetype || 'application/octet-stream' };
        }
        return null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=evolution.js.map