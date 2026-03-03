"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = query;
exports.withClient = withClient;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});
pool.on('error', (err) => {
    console.error('[DB] Pool error:', err);
});
/**
 * Executa uma query simples usando o pool diretamente.
 * O pool gerencia automaticamente o acquire/release da conexão.
 * Use para queries que NÃO precisam de transação.
 */
async function query(text, params) {
    return pool.query(text, params);
}
/**
 * Para operações que precisam de transação ou múltiplas queries
 * na mesma conexão, use este helper que garante o release.
 */
async function withClient(fn) {
    const client = await pool.connect();
    try {
        return await fn(client);
    }
    finally {
        client.release();
    }
}
exports.default = pool;
//# sourceMappingURL=db.js.map