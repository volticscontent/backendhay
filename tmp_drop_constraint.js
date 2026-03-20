const { Client } = require('pg');

const DATABASE_URL = 'postgres://postgres:3ad3550763e84d5864a7@easypanel.landcriativa.com:9000/systembots?sslmode=disable';

async function dropConstraint() {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    try {
        console.log('--- Removendo Constraints Conflitantes ---');
        
        await client.query(`ALTER TABLE "Chat" DROP CONSTRAINT IF EXISTS "Chat_instanceId_remoteJid_key"`);
        console.log('Constraint "Chat_instanceId_remoteJid_key" removida da tabela Chat.');

        await client.query(`ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_remoteJid_instanceId_key"`);
        console.log('Constraint "Contact_remoteJid_instanceId_key" removida da tabela Contact.');

        console.log('\n--- Removendo registros de migration falha ---');
        await client.query(`DELETE FROM "_prisma_migrations" WHERE migration_name = '20251122003044_add_chat_instance_remotejid_unique'`);
        
        console.log('\n✅ Pronto! O caminho está livre. Pode tentar o deploy da Evolution API novamente.');

    } catch (err) {
        console.error('Erro ao limpar constraints:', err);
    } finally {
        await client.end();
    }
}

dropConstraint();
