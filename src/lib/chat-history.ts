import pool from './db';

/**
 * Busca histórico de chat do banco de dados
 */
export async function getChatHistory(
    phone: string,
    limit: number = 20
): Promise<{ role: 'user' | 'system' | 'assistant'; content: string }[]> {
    const client = await pool.connect();
    try {
        const res = await client.query(
            `SELECT role, content FROM chat_history 
       WHERE phone = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
            [phone, limit]
        );
        return res.rows.reverse(); // Oldest first
    } catch (error) {
        console.error('[ChatHistory] Erro ao buscar histórico:', error);
        return [];
    } finally {
        client.release();
    }
}

/**
 * Adiciona mensagem ao histórico de chat
 */
export async function addToHistory(
    phone: string,
    role: 'user' | 'assistant' | 'system',
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
): Promise<void> {
    const client = await pool.connect();
    try {
        const textContent = typeof content === 'string'
            ? content
            : content.map(c => c.text || '[media]').join(' ');

        await client.query(
            `INSERT INTO chat_history (phone, role, content, created_at) VALUES ($1, $2, $3, NOW())`,
            [phone, role, textContent]
        );
    } catch (error) {
        console.error('[ChatHistory] Erro ao adicionar:', error);
    } finally {
        client.release();
    }
}
