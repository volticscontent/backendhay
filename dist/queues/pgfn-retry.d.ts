import { Queue, Worker } from 'bullmq';
export interface PgfnRetryJob {
    phone: string;
    cnpj: string;
}
export declare const pgfnRetryQueue: Queue<any, any, string, any, any, string>;
/**
 * Agenda a reconsulta da Dívida Ativa (PGFN) para a próxima abertura da janela (07:05–22:00).
 * jobId fixo por telefone evita agendar duas vezes para o mesmo lead.
 * Margem de +5min após a abertura para não bater exatamente na virada.
 */
export declare function schedulePgfnRetry(payload: PgfnRetryJob): Promise<number>;
export declare function startPgfnRetryWorker(): Worker;
//# sourceMappingURL=pgfn-retry.d.ts.map