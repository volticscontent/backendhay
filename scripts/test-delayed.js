
const http = require('http');

const payload = JSON.stringify({
  event: 'messages.upsert',
  instance: 'teste',
  data: {
    key: {
      remoteJid: '553182354127@s.whatsapp.net',
      fromMe: false,
      id: 'VERIFY_TEST_DELAYED_' + Date.now()
    },
    pushName: 'Sales',
    message: { conversation: 'TESTE SINCRONIZADO: Agora deve aparecer!' },
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
    'apikey': 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW'
  }
};

console.log('Aguardando 10 segundos antes de enviar o webhook...');
setTimeout(() => {
  console.log('Enviando webhook agora...');
  const req = http.request(options, (res) => {
    console.log('Status:', res.statusCode);
    res.on('data', d => console.log('Resposta:', d.toString()));
  });
  req.on('error', e => console.error('Erro:', e.message));
  req.write(payload);
  req.end();
}, 10000);
