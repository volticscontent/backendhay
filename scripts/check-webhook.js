
const fetch = require('node-fetch');

const API_KEY = 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW';
const BASE_URL = 'https://evolutionapi.landcriativa.com';

async function checkWebhook() {
    try {
        console.log('--- Verificando Webhook na Evolution ---');
        const response = await fetch(`${BASE_URL}/webhook/find/teste`, {
            headers: { apikey: API_KEY }
        });
        const data = await response.json();
        console.log('Configuração Atual:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Erro ao verificar webhook:', err);
    }
}

checkWebhook();
