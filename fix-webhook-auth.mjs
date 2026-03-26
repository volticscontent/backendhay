const apiKey = 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW';
const instanceName = 'teste';
const apiUrl = 'https://evolutionapi.landcriativa.com';
const webhookUrl = 'http://voltics_hayadmin:3001/api/webhook/whatsapp';

fetch(`${apiUrl}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
    body: JSON.stringify({
        webhook: {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: true,
            events: [
                "APPLICATION_STARTUP",
                "QRCODE_UPDATED",
                "MESSAGES_SET",
                "MESSAGES_UPSERT",
                "MESSAGES_UPDATE",
                "MESSAGES_DELETE",
                "SEND_MESSAGE",
                "CONTACTS_SET",
                "CONTACTS_UPSERT",
                "CONTACTS_UPDATE",
                "PRESENCE_UPDATE",
                "CHATS_SET",
                "CHATS_UPSERT",
                "CHATS_UPDATE",
                "CHATS_DELETE",
                "GROUPS_UPSERT",
                "GROUP_UPDATE",
                "GROUP_PARTICIPANTS_UPDATE",
                "CONNECTION_UPDATE",
                "CALL"
            ],
            // INJETANDO O HEADER PRA PASSAR NA VALIDAÇÃO DO BACKEND
            headers: {
                "apikey": apiKey
            }
        }
    })
}).then(r => r.json())
  .then(data => console.log('✅ Webhook Response:', data))
  .catch(e => console.error('❌ Webhook Erro:', e))
  .finally(() => process.exit(0));
