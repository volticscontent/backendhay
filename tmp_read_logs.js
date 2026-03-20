const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:3ad3550763e84d5864a7@easypanel.landcriativa.com:9000/systembots?sslmode=disable';

async function readLogs() {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    try {
        const res = await client.query(`
            SELECT migration_name, logs 
            FROM _prisma_migrations 
            WHERE migration_name = '20251122003044_add_chat_instance_remotejid_unique'
        `);
        console.log('Logs da Migration:', res.rows[0]?.logs);

    } catch (err) {
        console.error('Erro ao ler logs:', err);
    } finally {
        await client.end();
    }
}

readLogs();
