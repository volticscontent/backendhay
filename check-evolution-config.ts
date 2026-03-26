import 'dotenv/config';

async function checkEvolution() {
    const url = process.env.EVOLUTION_API_URL?.replace(/\/$/, '') || 'https://evolutionapi.landcriativa.com';
    const apikey = process.env.EVOLUTION_API_KEY || 'isfEQhkHq5tnvAa04A6VMisTec8JbvGW';
    const instance = process.env.EVOLUTION_INSTANCE_NAME || 'teste';

    console.log(`[Evolution Diagnostics] API: ${url} | Instance: ${instance}`);

    // Check connection status
    try {
        const res = await fetch(`${url}/instance/connectionState/${instance}`, {
            headers: { apikey }
        });
        const data = await res.json();
        console.log("\n📱 WhatsApp Connection State:", JSON.stringify(data, null, 2));
    } catch(e: any) {
        console.error("❌ Connection check failed:", e.message);
    }

    // Check webhook
    try {
        const res = await fetch(`${url}/webhook/find/${instance}`, {
            headers: { apikey }
        });
        const data = await res.json();
        console.log("\n🔗 Webhook Config:", JSON.stringify(data, null, 2));
    } catch(e: any) {
        console.error("❌ Webhook check failed:", e.message);
    }
}

checkEvolution();
