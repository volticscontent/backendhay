import { evolutionLogger } from './logger';
import redis from './redis';

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

        // Registrar atividade global da instância no Redis ao ter sucesso em qualquer requisição
        redis.set('evolution:last_activity', Date.now().toString()).catch(() => {});

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

export async function evolutionFindMessages(jid: string, limit: number = 30, page: number = 1): Promise<{
    messages?: { records?: Array<{ key: { fromMe: boolean }; message: unknown }> };
}> {
    return evolutionRequest(`/chat/findMessages/${EVOLUTION_INSTANCE_NAME}?page=${page}&limit=${limit}`, 'POST', {
        where: { key: { remoteJid: jid } },
        orderBy: { createdAt: 'desc' },
    }) as Promise<{ messages?: { records?: Array<{ key: { fromMe: boolean }; message: unknown }> } }>;
}

export async function evolutionSendWhatsAppAudio(jid: string, audio: string): Promise<unknown> {
    return evolutionRequest(`/message/sendWhatsAppAudio/${EVOLUTION_INSTANCE_NAME}`, 'POST', {
        number: jid,
        audio,
    });
}

export async function evolutionGetBase64FromMediaMessage(message: unknown): Promise<{ base64: string; mimetype: string } | null> {
    try {
        const result = await evolutionRequest(
            `/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE_NAME}`,
            'POST',
            { message, convertToMp4: false },
        ) as { base64?: string; mimetype?: string };
        if (result?.base64) return { base64: result.base64, mimetype: result.mimetype || 'application/octet-stream' };
        return null;
    } catch {
        return null;
    }
}

export async function evolutionFetchInstances(): Promise<unknown> {
    return evolutionRequest(`/instance/fetchInstances`, 'GET');
}

export async function evolutionGetConnectionState(): Promise<any> {
    return evolutionRequest(`/instance/connectionState/${EVOLUTION_INSTANCE_NAME}`, 'GET');
}

export async function evolutionConnectInstance(): Promise<unknown> {
    return evolutionRequest(`/instance/connect/${EVOLUTION_INSTANCE_NAME}`, 'GET');
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
/**
 * Atualiza as configurações da instância (Always Online, Reject Call, etc.)
 * Rota padrão da v2: /settings/set/{instance}
 */
export async function evolutionUpdateInstanceSettings(settings: {
    rejectCall?: boolean;
    msgCall?: string;
    groupsIgnore?: boolean;
    alwaysOnline?: boolean;
    readMessages?: boolean;
    readStatus?: boolean;
    syncFullHistory?: boolean;
    reconnectNetwork?: boolean;
    reconnectOnError?: boolean;
}): Promise<unknown> {
    return evolutionRequest(`/settings/set/${EVOLUTION_INSTANCE_NAME}`, 'POST', settings);
}

/**
 * Define as configurações de Webhook da instância
 */
export async function evolutionSetWebhook(config: {
    enabled: boolean;
    url?: string;
    webhookByEvents?: boolean;
    webhookBase64?: boolean;
    events?: string[];
}): Promise<unknown> {
    return evolutionRequest(`/webhook/set/${EVOLUTION_INSTANCE_NAME}`, 'POST', { webhook: config });
}

export async function evolutionFindChats(): Promise<unknown[]> {
    const result = await evolutionRequest(`/chat/findChats/${EVOLUTION_INSTANCE_NAME}`, 'POST', {});
    return Array.isArray(result) ? result : [];
}

export async function evolutionFindContacts(): Promise<Array<{ remoteJid: string; pushName: string | null; profilePicUrl?: string | null }>> {
    const result = await evolutionRequest(`/chat/findContacts/${EVOLUTION_INSTANCE_NAME}`, 'POST', { where: {} });
    return Array.isArray(result) ? result as Array<{ remoteJid: string; pushName: string | null; profilePicUrl?: string | null }> : [];
}

export async function checkWhatsAppNumbers(numbers: string[]): Promise<Array<{ exists: boolean; jid: string; number: string }>> {
    const result = await evolutionRequest(`/chat/whatsappNumbers/${EVOLUTION_INSTANCE_NAME}`, 'POST', { numbers });
    return Array.isArray(result) ? result as Array<{ exists: boolean; jid: string; number: string }> : [];
}

export function toWhatsAppJid(phone: string): string {
    const clean = phone.replace(/\D/g, '');
    return clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
}
