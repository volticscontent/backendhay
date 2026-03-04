// ==================== Logger Robusto ====================
// Sistema de logging estruturado com níveis, timers e request tracing.
// Formato: [timestamp] [LEVEL] [Module] mensagem

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

const LEVEL_COLOR: Record<LogLevel, string> = {
    DEBUG: '\x1b[36m',   // Cyan
    INFO: '\x1b[32m',    // Green
    WARN: '\x1b[33m',    // Yellow
    ERROR: '\x1b[31m',   // Red
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

function getConfiguredLevel(): LogLevel {
    const env = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
    if (env in LEVEL_PRIORITY) return env as LogLevel;
    return 'INFO';
}

function formatTimestamp(): string {
    return new Date().toISOString();
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60_000).toFixed(1)}min`;
}

export interface Timer {
    /** Encerra o timer e loga a duração */
    end: (extra?: string) => number;
    /** Retorna a duração parcial em ms sem encerrar */
    elapsed: () => number;
}

export class Logger {
    private module: string;
    private traceId?: string;
    private minLevel: LogLevel;

    constructor(module: string, traceId?: string) {
        this.module = module;
        this.traceId = traceId;
        this.minLevel = getConfiguredLevel();
    }

    // ==================== Factory ====================

    /** Cria sub-logger com módulo específico */
    child(module: string): Logger {
        return new Logger(module, this.traceId);
    }

    /** Cria sub-logger com traceId para rastreamento de request */
    withTrace(traceId: string): Logger {
        return new Logger(this.module, traceId);
    }

    // ==================== Logging ====================

    debug(msg: string, ...args: unknown[]): void {
        this.log('DEBUG', msg, args);
    }

    info(msg: string, ...args: unknown[]): void {
        this.log('INFO', msg, args);
    }

    warn(msg: string, ...args: unknown[]): void {
        this.log('WARN', msg, args);
    }

    error(msg: string, ...args: unknown[]): void {
        this.log('ERROR', msg, args);
    }

    // ==================== Performance ====================

    /**
     * Cria um timer para medir performance.
     * Uso:
     *   const t = logger.timer('OpenAI call');
     *   await openai.chat(...);
     *   t.end(); // Loga: [INFO] [Module] ⏱ OpenAI call concluído (1234ms)
     */
    timer(label: string): Timer {
        const start = performance.now();
        return {
            elapsed: () => performance.now() - start,
            end: (extra?: string) => {
                const duration = performance.now() - start;
                const suffix = extra ? ` — ${extra}` : '';
                this.info(`⏱ ${label} (${formatDuration(duration)})${suffix}`);
                return duration;
            },
        };
    }

    /**
     * Executa uma função async e loga a duração automaticamente.
     * Uso: const result = await logger.timed('Buscar usuário', () => getUser(phone));
     */
    async timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
        const t = this.timer(label);
        try {
            const result = await fn();
            t.end();
            return result;
        } catch (err) {
            const duration = t.elapsed();
            this.error(`⏱ ${label} FALHOU (${formatDuration(duration)})`, err);
            throw err;
        }
    }

    // ==================== Formatação ====================

    private log(level: LogLevel, msg: string, args: unknown[]): void {
        if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

        const ts = formatTimestamp();
        const color = LEVEL_COLOR[level];
        const traceTag = this.traceId ? ` ${DIM}[${this.traceId}]${RESET}` : '';
        const prefix = `${DIM}${ts}${RESET} ${color}${BOLD}${level.padEnd(5)}${RESET} ${BOLD}[${this.module}]${RESET}${traceTag}`;

        const fn = level === 'ERROR' ? console.error
            : level === 'WARN' ? console.warn
                : console.log;

        if (args.length > 0) {
            // Se o primeiro arg for um Error, formata stack
            const extra = args.map(a => {
                if (a instanceof Error) return `\n${DIM}  └─ ${a.stack || a.message}${RESET}`;
                if (typeof a === 'object') {
                    try { return JSON.stringify(a); } catch { return String(a); }
                }
                return String(a);
            }).join(' ');
            fn(`${prefix} ${msg} ${extra}`);
        } else {
            fn(`${prefix} ${msg}`);
        }
    }
}

// ==================== Instâncias Pré-configuradas ====================

/** Logger raiz — use logger.child('Modulo') para criar sub-loggers */
const logger = new Logger('App');

// Loggers por módulo (importação direta)
export const webhookLogger = new Logger('Webhook');
export const debounceLogger = new Logger('Debounce');
export const workerLogger = new Logger('Worker');
export const followUpLogger = new Logger('FollowUp');
export const queueLogger = new Logger('Queue');
export const agentLogger = new Logger('Agent');
export const cronLogger = new Logger('CRON');
export const bootLogger = new Logger('Boot');
export const dbLogger = new Logger('DB');
export const redisLogger = new Logger('Redis');
export const socketLogger = new Logger('Socket');
export const evolutionLogger = new Logger('Evolution');
export const r2Logger = new Logger('R2');
export const serproLogger = new Logger('Serpro');

export default logger;
