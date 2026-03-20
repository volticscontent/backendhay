const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:3ad3550763e84d5864a7@easypanel.landcriativa.com:9000/systembots?sslmode=disable';

async function dropIndex() {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    try {
        console.log('--- Removendo Índices Conflitantes ---');
        await client.query(`DROP INDEX IF EXISTS "Chat_instanceId_remoteJid_key"`);
        console.log('Índice "Chat_instanceId_remoteJid_key" removido.');

        await client.query(`DROP INDEX IF EXISTS "Contact_remoteJid_instanceId_key"`);
        console.log('Índice "Contact_remoteJid_instanceId_key" removido.');

        console.log('\n--- Removendo registros de migration falha ---');
        await client.query(`DELETE FROM "_prisma_migrations" WHERE migration_name = '20251122003044_add_chat_instance_remotejid_unique'`);
        
        console.log('\n✅ Pronto! O caminho está livre. Pode rodar o deploy da Evolution API agora.');

    } catch (err) {
        console.error('Erro ao limpar índices:', err);
    } finally {
        await client.end();
    }
}

dropIndex();
