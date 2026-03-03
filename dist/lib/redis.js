"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new ioredis_1.default(REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        console.warn(`[Redis] Reconectando... tentativa ${times}, delay ${delay}ms`);
        return delay;
    },
});
exports.redis = redis;
redis.on('connect', () => {
    console.log('[Redis] Conectado com sucesso');
});
redis.on('error', (err) => {
    console.error('[Redis] Erro de conexão:', err.message);
});
exports.default = redis;
//# sourceMappingURL=redis.js.map