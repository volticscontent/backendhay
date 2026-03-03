import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        console.warn(`[Redis] Reconectando... tentativa ${times}, delay ${delay}ms`);
        return delay;
    },
});

redis.on('connect', () => {
    console.log('[Redis] Conectado com sucesso');
});

redis.on('error', (err) => {
    console.error('[Redis] Erro de conexão:', err.message);
});

export { redis };
export default redis;
