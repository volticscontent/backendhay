import Redis from 'ioredis';
import { redisLogger } from './logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        redisLogger.warn(`Reconectando... tentativa ${times}, delay ${delay}ms`);
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
