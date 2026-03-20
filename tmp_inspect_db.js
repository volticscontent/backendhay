const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:3ad3550763e84d5864a7@easypanel.landcriativa.com:9000/systembots?sslmode=disable';

async function inspectDb() {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    try {
        console.log('--- Colunas em "Chat" ---');
        const chatCols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'Chat'`);
        console.log(chatCols.rows.map(r => r.column_name));

        console.log('\n--- Colunas em "_prisma_migrations" ---');
        const migCols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '_prisma_migrations'`);
        console.log(migCols.rows.map(r => r.column_name));

        console.log('\n--- Status das Migrações (Correto) ---');
        const scriptRes = await client.query(`
            SELECT migration_name, status, started_at, finished_at 
            FROM _prisma_migrations 
            ORDER BY started_at DESC 
            LIMIT 10
        `);
        console.table(scriptRes.rows);

        console.log('\n--- Tentando encontrar duplicatas com trim/case insensitive ---');
        const dups = await client.query(`
            SELECT "instanceId", "remoteJid", COUNT(*) 
            FROM "Chat" 
            GROUP BY "instanceId", "remoteJid" 
            HAVING COUNT(*) > 1
        `);
        console.log('Duplicatas Reais em Chat:', dups.rows);

    } catch (err) {
        console.error('Erro ao consultar DB:', err);
    } finally {
        await client.end();
    }
}

inspectDb();
