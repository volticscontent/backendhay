import { evolutionLogger } from './logger';

const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || '';
const EVOLUTION_TIMEOUT_MS = parseInt(process.env.EVOLUTION_TIMEOUT_MS || '30000', 10);

async function evolutionRequest(path: string, method: string = 'GET', body?: unknown): Promise<unknown> {
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
            evolutionLogger.error(`Evolution API Error ${response.status} em ${path}:`, errorText);
            throw new Error(`Evolution API Error ${response.status}: ${errorText}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function evolutionSendTextMessage(jid: string, text: string): Promise<unknown> {
    return evolutionRequest(`/message/sendText/${EVOLUTION_INSTANCE_NAME}`, 'POST', {
        number: jid,
        text,
    });
}

export async function evolutionSendMediaMessage(
    jid: string,
    mediaUrl: string,
    mediatype: 'image' | 'video' | 'audio' | 'document',
    caption: string,
    fileName: string,
    mimetype: string
): Promise<unknown> {
    return evolutionRequest(`/message/sendMedia/${EVOLUTION_INSTANCE_NAME}`, 'POST', {
        number: jid,
        media: mediaUrl,
        mediatype,
        caption,
        fileName,
        mimetype,
    });
}

export async function evolutionFindMessages(jid: string, limit: number = 30): Promise<{
    messages?: { records?: Array<{ key: { fromMe: boolean }; message: unknown }> };
}> {
    return evolutionRequest(`/chat/findMessages/${EVOLUTION_INSTANCE_NAME}`, 'POST', {
        where: {
            key: {
                remoteJid: jid,
            },
        },
        limit,
    }) as Promise<{ messages?: { records?: Array<{ key: { fromMe: boolean }; message: unknown }> } }>;
}

export async function evolutionFetchInstances(): Promise<unknown> {
    return evolutionRequest(`/instance/fetchInstances`, 'GET');
}

export async function evolutionGetProfilePic(jid: string): Promise<unknown> {
    return evolutionRequest(`/chat/fetchProfilePictureUrl/${EVOLUTION_INSTANCE_NAME}`, 'POST', {
        number: jid,
    });
}

/**
 * Baixa a mídia de uma mensagem em base64 usando o endpoint getBase64FromMediaMessage.
 * Útil quando o webhook não envia o base64 inline.
 */
export async function evolutionGetBase64FromMedia(
    messageId: string,
    convertToMp4: boolean = false,
): Promise<{ base64: string; mimetype: string } | null> {
    try {
        const result = await evolutionRequest(
            `/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE_NAME}`,
            'POST',
            { message: { key: { id: messageId } }, convertToMp4 },
        ) as { base64?: string; mimetype?: string };

        if (result?.base64) {
            return { base64: result.base64, mimetype: result.mimetype || 'application/octet-stream' };
        }
        return null;
    } catch {
        return null;
    }
}
