"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChatHistory = getChatHistory;
exports.addToHistory = addToHistory;
const db_1 = __importDefault(require("./db"));
/**
 * Busca histórico de chat do banco de dados
 */
async function getChatHistory(phone, limit = 20) {
    const client = await db_1.default.connect();
    try {
        const res = await client.query(`SELECT role, content FROM chat_history 
       WHERE phone = $1 
       ORDER BY created_at DESC 
       LIMIT $2`, [phone, limit]);
        return res.rows.reverse(); // Oldest first
    }
    catch (error) {
        console.error('[ChatHistory] Erro ao buscar histórico:', error);
        return [];
    }
    finally {
        client.release();
    }
}
/**
 * Adiciona mensagem ao histórico de chat
 */
async function addToHistory(phone, role, content) {
    const client = await db_1.default.connect();
    try {
        const textContent = typeof content === 'string'
            ? content
            : content.map(c => c.text || '[media]').join(' ');
        await client.query(`INSERT INTO chat_history (phone, role, content, created_at) VALUES ($1, $2, $3, NOW())`, [phone, role, textContent]);
    }
    catch (error) {
        console.error('[ChatHistory] Erro ao adicionar:', error);
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=chat-history.js.map