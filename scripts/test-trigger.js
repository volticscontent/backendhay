
const axios = require('axios');

const url = 'http://127.0.0.1:3001/api/webhook/whatsapp';
const apiKey = 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW';

const payload = {
  event: 'messages.upsert',
  instance: 'teste',
  data: {
    key: {
      remoteJid: '553182354127@s.whatsapp.net',
      fromMe: false,
      id: 'VERIFY_TEST_' + Date.now()
    },
    pushName: 'Sales',
    message: { conversation: 'TESTE AUTOMATICO: A mensagem apareceu no chat?' },
    messageTimestamp: Math.floor(Date.now() / 1000)
  }
};

async function test() {
  console.log('Enviando webhook de teste para:', url);
  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey
      }
    });
    console.log('Resposta do Webhook:', response.status, response.data);
  } catch (error) {
    console.error('Erro ao enviar webhook:', error.response ? error.response.status : error.message);
    if (error.response) console.log('Detalhes:', error.response.data);
  }
}

test();
