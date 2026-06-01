require('dotenv').config();
import redis from './src/lib/redis';

async function check() {
    const routingOverride = await redis.get('routing_override:553182354127');
    console.log('routing_override:553182354127 =', routingOverride);
    const cnpjAtivo = await redis.get('session:cnpj_ativo:2');
    console.log('session:cnpj_ativo:2 =', cnpjAtivo);
    await redis.disconnect();
}

check().catch(console.error);
