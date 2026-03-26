const apiKey = 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW';
const instanceName = 'teste'; // Use the correct active instance name
const apiUrl = 'https://evolutionapi.landcriativa.com';
const webhookUrl = 'https://voltics-hayadmin.rzkso2.easypanel.host/api/webhook/whatsapp';

const events = [
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
];

Promise.all([
    fetch(`${apiUrl}/webhook/set/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
        body: JSON.stringify({
            webhook: {
                enabled: true,
                url: webhookUrl,
                webhookByEvents: false,
                webhookBase64: true,
                events: events
            }
        })
    }).then(r => r.json()).then(data => console.log('✅ Webhook Response:', data)).catch(e => console.error('❌ Webhook Erro:', e)),

    fetch(`${apiUrl}/websocket/set/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
        body: JSON.stringify({
            websocket: {
                enabled: true,
                events: events
            }
        })
    }).then(r => r.json()).then(data => console.log('✅ WebSocket Response:', data)).catch(e => console.error('❌ WebSocket Erro:', e))
]).then(() => process.exit(0));
