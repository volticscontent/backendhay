"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evolutionSendTextMessage = evolutionSendTextMessage;
exports.evolutionSendMediaMessage = evolutionSendMediaMessage;
exports.evolutionFindMessages = evolutionFindMessages;
exports.evolutionFetchInstances = evolutionFetchInstances;
exports.evolutionGetProfilePic = evolutionGetProfilePic;
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
            throw new Error(`Evolution API Error ${response.status}: ${errorText}`);
        }
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
async function evolutionGetProfilePic(jid) {
    return evolutionRequest(`/chat/fetchProfilePictureUrl/${EVOLUTION_INSTANCE_NAME}`, 'POST', {
        number: jid,
    });
}
//# sourceMappingURL=evolution.js.map