// Script simples para testar o recebimento de mensagens pelo webhook local
const http = require('http');

const PORT = 3001;
const WEBHOOK_URL = `http://localhost:${PORT}/api/webhook/whatsapp`;

// Variáveis configuráveis para o teste
const TEST_PHONE = "553182354127"; // Digite um celular de teste com o 55
const TEST_MESSAGE = "Oi, quero regularizar meu MEI.";
const PUSH_NAME = "Cliente Teste";

const payload = {
    event: 'messages.upsert',
    senderpn: `${TEST_PHONE}@s.whatsapp.net`,
    data: {
        message: {
            conversation: TEST_MESSAGE
        },
        pushName: PUSH_NAME,
        key: {
            remoteJid: `${TEST_PHONE}@s.whatsapp.net`,
            fromMe: false
        }
    }
};

const payloadString = JSON.stringify(payload);

const options = {
    hostname: '127.0.0.1',
    port: PORT,
    path: '/api/webhook/whatsapp',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadString),
        'apikey': 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW'
    }
};

console.log(`\n🚀 Enviando mensagem de teste: "${TEST_MESSAGE}"`);
console.log(`📞 De: ${TEST_PHONE}`);
console.log(`📡 Para o webhook local: ${WEBHOOK_URL}\n`);

const req = http.request(options, (res) => {
    console.log(`Status do backend: ${res.statusCode}`);

    res.on('data', (d) => {
        process.stdout.write(`Resposta: ${d}\n`);
    });
});

req.on('error', (error) => {
    console.error('\n❌ Erro ao enviar para o webhook. Verifique se o backend está rodando em D:\\Códigos\\haylander\\haylanderform\\bot-backend usando npm run dev');
    console.error(error.message);
});

req.write(payloadString);
req.end();
