const fetchSetWebhook = async () => {
    try {
        const response = await fetch('https://evolutionapi.landcriativa.com/webhook/set/teste', {
            method: 'POST',
            headers: {
                apikey: 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                webhook: {
                    enabled: true,
                    url: "https://voltics-hayadmin.rzkso2.easypanel.host/api/webhook/whatsapp",
                    webhookByEvents: false,
                    webhookBase64: true,
                    headers: {
                        apikey: "isfEQhkHq5tnvAa04A6VMisTec8JbvGW"
                    },
                    events: [
                        "MESSAGES_UPSERT"
                    ]
                }
            })
        });
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(err);
    }
};
fetchSetWebhook();
