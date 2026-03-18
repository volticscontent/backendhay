import Redis from 'ioredis';
import { redisLogger } from './logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Cria uma nova conexão Redis independente.
 * Use para BullMQ queues/workers — cada um PRECISA de sua própria conexão
 * para evitar bloqueio por comandos como BRPOPLPUSH.
 */
export function createRedisConnection(): Redis {
    return new Redis(REDIS_URL, {
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
        keepAlive: 10000,
        retryStrategy(times: number) {
            const delay = Math.min(times * 200, 5000);
            redisLogger.warn(`[BullMQ] Reconectando... tentativa ${times}, delay ${delay}ms`);
            return delay;
        },
    });
}

/** Conexão compartilhada para cache, pub/sub e operações gerais (NÃO usar em BullMQ) */
const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10000,
    retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        redisLogger.warn(`[Shared] Reconectando... tentativa ${times}, delay ${delay}ms`);
        return delay;
    },
});

redis.on('connect', () => {
    redisLogger.info('Conectado com sucesso');
});

redis.on('error', (err) => {
    redisLogger.error('Erro de conexão:', err);
});

export { redis };
export default redis;
