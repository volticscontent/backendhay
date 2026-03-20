const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:3ad3550763e84d5864a7@easypanel.landcriativa.com:9000/systembots?sslmode=disable';

async function fixDb() {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    try {
        console.log('--- Removendo Duplicatas em "Chat" ---');
        // Mantém apenas a versão mais recente de cada par (instanceId, remoteJid)
        const deleteRes = await client.query(`
            DELETE FROM "Chat" a USING "Chat" b
            WHERE a.id < b.id
            AND a."instanceId" = b."instanceId"
            AND a."remoteJid" = b."remoteJid"
        `);
        console.log(`Removidas ${deleteRes.rowCount} duplicatas em Chat.`);

        console.log('\n--- Removendo Registro de Migration Falha ---');
        const fixMig = await client.query(`
            DELETE FROM "_prisma_migrations"
            WHERE migration_name = '20251122003044_add_chat_instance_remotejid_unique'
            AND finished_at IS NULL
        `);
        console.log(`Registros de migration falha removidos: ${fixMig.rowCount}`);

        console.log('\n✅ Pronto! Agora você pode tentar rodar o deploy da Evolution API novamente.');

    } catch (err) {
        console.error('Erro ao corrigir DB:', err);
    } finally {
        await client.end();
    }
}

fixDb();
