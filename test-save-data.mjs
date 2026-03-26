const apiKey = 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW';
const instanceName = 'teste';
const apiUrl = 'https://evolutionapi.landcriativa.com';

fetch(`${apiUrl}/chat/updateSaveData/${instanceName}`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey
    },
    body: JSON.stringify({
        message: true,
        contacts: true,
        chats: true,
        labels: true,
        historic: false
    })
})
.then(r => r.json())
.then(data => {
    console.log("Success:", data);
})
.catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
