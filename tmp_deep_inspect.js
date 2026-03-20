const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:3ad3550763e84d5864a7@easypanel.landcriativa.com:9000/systembots?sslmode=disable';

async function deepInspect() {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    try {
        console.log('--- Verificando Duplicatas em "Contact" (instanceId + remoteJid) ---');
        const contactRes = await client.query(`
            SELECT "instanceId", "remoteJid", COUNT(*) 
            FROM "Contact" 
            GROUP BY "instanceId", "remoteJid" 
            HAVING COUNT(*) > 1
        `);
        console.log('Duplicatas em Contact:', contactRes.rows);

        console.log('\n--- Verificando Duplicatas em "Chat" usando LOWER() ---');
        const chatLowerRes = await client.query(`
            SELECT LOWER("instanceId"), LOWER("remoteJid"), COUNT(*) 
            FROM "Chat" 
            GROUP BY LOWER("instanceId"), LOWER("remoteJid") 
            HAVING COUNT(*) > 1
        `);
        console.log('Duplicatas em Chat (case-insensitive):', chatLowerRes.rows);

        console.log('\n--- Verificando se existe a constraint/index antes de tentar criar ---');
        const indexRes = await client.query(`
            SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Chat' OR tablename = 'Contact'
        `);
        console.table(indexRes.rows);

        if (contactRes.rows.length > 0) {
            console.log('\nCleaning Contact duplicates...');
            await client.query(`
                DELETE FROM "Contact" a USING "Contact" b
                WHERE a.id < b.id
                AND a."instanceId" = b."instanceId"
                AND a."remoteJid" = b."remoteJid"
            `);
        }

        if (chatLowerRes.rows.length > 0) {
            console.log('\nCleaning Chat duplicates (including case conflict)...');
            // This is trickier, let's just keep one.
             await client.query(`
                DELETE FROM "Chat" a USING "Chat" b
                WHERE a.id < b.id
                AND LOWER(a."instanceId") = LOWER(b."instanceId")
                AND LOWER(a."remoteJid") = LOWER(b."remoteJid")
            `);
        }

        console.log('\nDeleting failed migration record again...');
        await client.query(`DELETE FROM "_prisma_migrations" WHERE migration_name = '20251122003044_add_chat_instance_remotejid_unique'`);

    } catch (err) {
        console.error('Erro no diagnóstico:', err);
    } finally {
        await client.end();
    }
}

deepInspect();
