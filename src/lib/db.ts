import { Pool, QueryResult, PoolClient } from 'pg';
import { dbLogger } from './logger';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
    dbLogger.error('Pool error:', err);
});

// Pool separado para o banco da Evolution API (systembots)
// As tabelas Message, Contact, Chat, Instance vivem aqui
export const evolutionPool = new Pool({
    connectionString: process.env.EVOLUTION_DB_URL || process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

evolutionPool.on('error', (err) => {
    dbLogger.error('Evolution pool error:', err);
});

/**
 * Executa uma query simples usando o pool diretamente.
 * O pool gerencia automaticamente o acquire/release da conexão.
 * Use para queries que NÃO precisam de transação.
 */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[]
): Promise<QueryResult<T>> {
    return pool.query<T>(text, params);
}

/**
 * Para operações que precisam de transação ou múltiplas queries
 * na mesma conexão, use este helper que garante o release.
 */
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        return await fn(client);
    } finally {
        client.release();
    }
}

export default pool;
