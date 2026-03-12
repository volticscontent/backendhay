import { Pool, QueryResult, PoolClient } from 'pg';
declare const pool: Pool;
/**
 * Executa uma query simples usando o pool diretamente.
 * O pool gerencia automaticamente o acquire/release da conexão.
 * Use para queries que NÃO precisam de transação.
 */
export declare function query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
/**
 * Para operações que precisam de transação ou múltiplas queries
 * na mesma conexão, use este helper que garante o release.
 */
export declare function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
export default pool;
//# sourceMappingURL=db.d.ts.map