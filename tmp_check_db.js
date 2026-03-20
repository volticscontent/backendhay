const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:3ad3550763e84d5864a7@easypanel.landcriativa.com:9000/systembots?sslmode=disable';

async function checkDuplicates() {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    try {
        console.log('--- Verificando Duplicatas em "Chat" ---');
        const chatRes = await client.query(`
            SELECT "instanceId", "remoteJid", COUNT(*) 
            FROM "Chat" 
            GROUP BY "instanceId", "remoteJid" 
            HAVING COUNT(*) > 1
        `);
        console.log('Duplicatas em Chat:', chatRes.rows);

        console.log('\n--- Verificando Duplicatas em "Contact" ---');
        const contactRes = await client.query(`
            SELECT "instanceId", "remoteJid", COUNT(*) 
            FROM "Contact" 
            GROUP BY "instanceId", "remoteJid" 
            HAVING COUNT(*) > 1
        `);
        console.log('Duplicatas em Contact:', contactRes.rows);

        console.log('\n--- Verificando Status das Migrações ---');
        const scriptRes = await client.query(`
            SELECT name, status, started_at, finished_at 
            FROM _prisma_migrations 
            WHERE status != 'success' OR name LIKE '%unique%'
            ORDER BY started_at DESC 
            LIMIT 5
        `);
        console.table(scriptRes.rows);

        if (chatRes.rows.length > 0 || contactRes.rows.length > 0) {
            console.log('\n⚠️ DUPLICATAS ENCONTRADAS. Sugerindo script de limpeza...');
        } else {
            console.log('\n✅ Nenhuma duplicata encontrada que viole o índice único.');
        }

    } catch (err) {
        console.error('Erro ao consultar DB:', err);
    } finally {
        await client.end();
    }
}

checkDuplicates();
