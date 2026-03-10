const { Client } = require('pg');
require('dotenv').config();

async function clearApoloMemory() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        await client.connect();

        // Deleta todo o histórico de conversas da tabela chat_history
        const res = await client.query('DELETE FROM chat_history');

        console.log(`✅ Memória do Apolo foi apagada com sucesso! ${res.rowCount} mensagens deletadas.`);

    } catch (err) {
        console.error('Erro ao limpar memória:', err);
    } finally {
        await client.end();
    }
}

clearApoloMemory();
