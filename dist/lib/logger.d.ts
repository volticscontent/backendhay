export interface Timer {
    /** Encerra o timer e loga a duração */
    end: (extra?: string) => number;
    /** Retorna a duração parcial em ms sem encerrar */
    elapsed: () => number;
}
export declare class Logger {
    private module;
    private traceId?;
    private minLevel;
    constructor(module: string, traceId?: string);
    /** Cria sub-logger com módulo específico */
    child(module: string): Logger;
    /** Cria sub-logger com traceId para rastreamento de request */
    withTrace(traceId: string): Logger;
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
    /**
     * Cria um timer para medir performance.
     * Uso:
     *   const t = logger.timer('OpenAI call');
     *   await openai.chat(...);
     *   t.end(); // Loga: [INFO] [Module] ⏱ OpenAI call concluído (1234ms)
     */
    timer(label: string): Timer;
    /**
     * Executa uma função async e loga a duração automaticamente.
     * Uso: const result = await logger.timed('Buscar usuário', () => getUser(phone));
     */
    timed<T>(label: string, fn: () => Promise<T>): Promise<T>;
    private log;
}
/** Logger raiz — use logger.child('Modulo') para criar sub-loggers */
declare const logger: Logger;
export declare const webhookLogger: Logger;
export declare const debounceLogger: Logger;
export declare const workerLogger: Logger;
export declare const followUpLogger: Logger;
export declare const queueLogger: Logger;
export declare const agentLogger: Logger;
export declare const cronLogger: Logger;
export declare const bootLogger: Logger;
export declare const dbLogger: Logger;
export declare const redisLogger: Logger;
export declare const socketLogger: Logger;
export declare const evolutionLogger: Logger;
export declare const r2Logger: Logger;
export declare const serproLogger: Logger;
export default logger;
//# sourceMappingURL=logger.d.ts.map