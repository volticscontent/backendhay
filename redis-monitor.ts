import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://default:8023c89e448aa4277b42@easypanel.landcriativa.com:1000';
const redis = new Redis(redisUrl);

console.log("Connecting to Redis: " + redisUrl);

redis.subscribe('haylander-bot-events', 'haylander-chat-updates', (err) => {
    if (err) console.error("Failed to subscribe:", err);
    else console.log("✅ Subscribed to Redis channels!");
});

redis.on('message', (channel, message) => {
    console.log(`\n=== 🔴 REDIS PUB/SUB EVENT [${channel}] ===`);
    console.log(message);
    console.log(`=========================================\n`);
});

setTimeout(() => {
    console.log("Monitor exiting after 60s.");
    process.exit(0);
}, 60000);
