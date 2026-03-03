import redis from './redis';

const SOCKET_SERVER_URL = process.env.SOCKET_SERVER_URL;

/**
 * Notifica o Socket Server via Redis Pub/Sub ou HTTP fallback
 */
export async function notifySocketServer(channel: string, data: unknown): Promise<void> {
    try {
        // Pub/Sub (preferido — baixa latência)
        await redis.publish(channel, JSON.stringify(data));
    } catch (pubsubError) {
        console.warn('[Socket] Redis Pub/Sub falhou, tentando HTTP fallback:', pubsubError);

        // HTTP Fallback
        if (SOCKET_SERVER_URL) {
            try {
                await fetch(`${SOCKET_SERVER_URL}/notify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel, data }),
                });
            } catch (httpError) {
                console.error('[Socket] HTTP fallback também falhou:', httpError);
            }
        }
    }
}
