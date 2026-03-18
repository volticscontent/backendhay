import redis from './redis';
import { socketLogger } from './logger';

const SOCKET_SERVER_URL = process.env.SOCKET_SERVER_URL;

/**
 * Notifica o Socket Server via Redis Pub/Sub ou HTTP fallback
 */
export async function notifySocketServer(channel: string, data: unknown): Promise<void> {
    try {
        // Pub/Sub (preferido — baixa latência)
        const payload = JSON.stringify(data);
        socketLogger.debug(`🚀 Publicando no Redis [${channel}]: ${payload.substring(0, 100)}...`);
        await redis.publish(channel, payload);
    } catch (pubsubError) {
        socketLogger.warn('Redis Pub/Sub falhou, tentando HTTP fallback:', pubsubError);

        // HTTP Fallback
        if (SOCKET_SERVER_URL) {
            try {
                await fetch(`${SOCKET_SERVER_URL}/notify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel, data }),
                });
            } catch (httpError) {
                socketLogger.error('HTTP fallback também falhou:', httpError);
            }
        }
    }
}
