import 'dotenv/config';
import { io } from 'socket.io-client';

const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || '';

console.log('🔍 Diagnóstico WebSocket Evolution API');
console.log('URL:', EVOLUTION_API_URL);
console.log('Instance:', EVOLUTION_INSTANCE_NAME);

function testConnection(name: string, options: Record<string, unknown>) {
    console.log(`\n--- Testando: ${name} ---`);
    const socket = io(EVOLUTION_API_URL, options);

    socket.on('connect', () => {
        console.log(`[${name}] ✅ Conectado! ID:`, socket.id);
        socket.emit('subscribe', EVOLUTION_INSTANCE_NAME);
    });

    socket.on('connect_error', (err) => {
        console.error(`[${name}] ❌ Erro de conexão:`, err.message);
    });

    socket.onAny((event, ...args) => {
        console.log(`[${name}] 📩 Evento [${event}]:`, JSON.stringify(args).substring(0, 100));
    });

    // Timeout para fechar o teste
    setTimeout(() => {
        console.log(`[${name}] Encerrando teste.`);
        socket.disconnect();
    }, 15000);
}

// Cenário 1: Default (Query apikey)
testConnection('Cenário 1 (Query)', {
    query: { apikey: EVOLUTION_API_KEY },
    transports: ['websocket']
});

// Cenário 2: Headers (ExtraHeaders)
testConnection('Cenário 2 (Headers)', {
    extraHeaders: { apikey: EVOLUTION_API_KEY },
    transports: ['websocket']
});

// Cenário 3: Namespace (Teste)
testConnection('Cenário 3 (Polling)', {
    query: { apikey: EVOLUTION_API_KEY },
    transports: ['polling', 'websocket']
});
