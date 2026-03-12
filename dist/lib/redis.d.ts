import Redis from 'ioredis';
/**
 * Cria uma nova conexão Redis independente.
 * Use para BullMQ queues/workers — cada um PRECISA de sua própria conexão
 * para evitar bloqueio por comandos como BRPOPLPUSH.
 */
export declare function createRedisConnection(): Redis;
/** Conexão compartilhada para cache, pub/sub e operações gerais (NÃO usar em BullMQ) */
declare const redis: Redis;
export { redis };
export default redis;
//# sourceMappingURL=redis.d.ts.map