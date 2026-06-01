require('dotenv').config();
const redis = require('./dist/lib/redis').default;

async function check() {
    try {
        const routingOverride = await redis.get('routing_override:553182354127');
        console.log('routing_override:553182354127 =', routingOverride);
        const cnpjAtivo = await redis.get('session:cnpj_ativo:2');
        console.log('session:cnpj_ativo:2 =', cnpjAtivo);
    } catch (e) {
        console.error('Error checking Redis:', e);
    } finally {
        if (redis && redis.disconnect) {
            await redis.disconnect();
        }
    }
}

check();
