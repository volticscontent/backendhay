const apiKey = 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW';
const instanceName = 'teste';
const apiUrl = 'https://evolutionapi.landcriativa.com';

fetch(`${apiUrl}/chat/findMessages/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
    body: JSON.stringify({
        where: {
            "key": {
                "remoteJid": "209731943718925@lid"
            }
        },
        limit: 5
    })
}).then(r => r.json())
  .then(data => console.log('✅ Messages under LID:', JSON.stringify(data, null, 2)))
  .catch(e => console.error('❌ Erro:', e))
  .finally(() => process.exit(0));
