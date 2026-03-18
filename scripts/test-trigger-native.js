
const http = require('http');

const url = 'http://127.0.0.1:3001/api/webhook/whatsapp';
const apiKey = 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW';

const payload = JSON.stringify({
  event: 'messages.upsert',
  instance: 'teste',
  data: {
    key: {
      remoteJid: '553182354127@s.whatsapp.net',
      fromMe: false,
      id: 'VERIFY_TEST_V2_' + Date.now()
    },
    pushName: 'Sales',
    message: { conversation: 'TESTE AUTOMATICO V2: Mensagem entrando...' },
    messageTimestamp: Math.floor(Date.now() / 1000)
  }
});

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/webhook/whatsapp',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': payload.length,
    'apikey': apiKey
  }
};

console.log('Enviando webhook de teste (native http) para:', url);

const req = http.request(options, (res) => {
  console.log('Status do Webhook:', res.statusCode);
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    console.log('Resposta:', chunk);
  });
});

req.on('error', (e) => {
  console.error('Erro ao enviar webhook:', e.message);
});

req.write(payload);
req.end();
