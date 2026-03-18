"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
exports.createRedisConnection = createRedisConnection;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("./logger");
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
/**
 * Cria uma nova conexão Redis independente.
 * Use para BullMQ queues/workers — cada um PRECISA de sua própria conexão
 * para evitar bloqueio por comandos como BRPOPLPUSH.
 */
function createRedisConnection() {
    return new ioredis_1.default(REDIS_URL, {
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
        keepAlive: 10000,
        retryStrategy(times) {
            const delay = Math.min(times * 200, 5000);
            logger_1.redisLogger.warn(`[BullMQ] Reconectando... tentativa ${times}, delay ${delay}ms`);
            return delay;
        },
    });
}
/** Conexão compartilhada para cache, pub/sub e operações gerais (NÃO usar em BullMQ) */
const redis = new ioredis_1.default(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10000,
    retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        logger_1.redisLogger.warn(`[Shared] Reconectando... tentativa ${times}, delay ${delay}ms`);
        return delay;
    },
});
exports.redis = redis;
redis.on('connect', () => {
    logger_1.redisLogger.info('Conectado com sucesso');
});
redis.on('error', (err) => {
    logger_1.redisLogger.error('Erro de conexão:', err);
});
exports.default = redis;
//# sourceMappingURL=redis.js.map