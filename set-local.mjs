import fetch from 'node-fetch';

// Pega a URL do argumento de linha de comando ou da variável de ambiente
const LOCAL_URL = process.argv[2] || process.env.LOCAL_URL;

if (!LOCAL_URL) {
    console.error('❌ ERRO: Forneça a URL do tunnel como argumento. Exemplo: node set-local.mjs https://sua-url.ngrok-free.app');
    process.exit(1);
}

// Limpar a URL caso venha com / no final
const cleanUrl = LOCAL_URL.replace(/\/$/, '');

const fetchSetWebhook = async () => {
    try {
        console.log(`🔗 Atualizando webhook na Evolution para: ${cleanUrl}/api/webhook/whatsapp ...`);
        const response = await fetch('https://evolutionapi.landcriativa.com/webhook/set/teste', {
            method: 'POST',
            headers: {
                apikey: 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                webhook: {
                    enabled: true,
                    url: `${cleanUrl}/api/webhook/whatsapp`,
                    webhookByEvents: false,
                    webhookBase64: true,
                    headers: {
                        apikey: "isfEQhkHq5tnvAa04A6VMisTec8JbvGW",
                        "bypass-tunnel-reminder": "true"
                    },
                    events: [
                        "MESSAGES_UPSERT"
                    ]
                }
            })
        });
        const data = await response.json();
        console.log('✅ Webhook atualizado com sucesso:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('❌ Erro ao atualizar webhook:', err);
    }
};

fetchSetWebhook();
