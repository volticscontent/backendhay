"use strict";
// ==================== Logger Robusto ====================
// Sistema de logging estruturado com níveis, timers e request tracing.
// Formato: [timestamp] [LEVEL] [Module] mensagem
Object.defineProperty(exports, "__esModule", { value: true });
exports.serproLogger = exports.r2Logger = exports.evolutionLogger = exports.socketLogger = exports.redisLogger = exports.dbLogger = exports.bootLogger = exports.cronLogger = exports.agentLogger = exports.queueLogger = exports.followUpLogger = exports.workerLogger = exports.debounceLogger = exports.webhookLogger = exports.Logger = void 0;
const LEVEL_PRIORITY = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};
const LEVEL_COLOR = {
    DEBUG: '\x1b[36m', // Cyan
    INFO: '\x1b[32m', // Green
    WARN: '\x1b[33m', // Yellow
    ERROR: '\x1b[31m', // Red
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
function getConfiguredLevel() {
    const env = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
    if (env in LEVEL_PRIORITY)
        return env;
    return 'INFO';
}
function formatTimestamp() {
    return new Date().toISOString();
}
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms.toFixed(0)}ms`;
    if (ms < 60_000)
        return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60_000).toFixed(1)}min`;
}
class Logger {
    module;
    traceId;
    minLevel;
    constructor(module, traceId) {
        this.module = module;
        this.traceId = traceId;
        this.minLevel = getConfiguredLevel();
    }
    // ==================== Factory ====================
    /** Cria sub-logger com módulo específico */
    child(module) {
        return new Logger(module, this.traceId);
    }
    /** Cria sub-logger com traceId para rastreamento de request */
    withTrace(traceId) {
        return new Logger(this.module, traceId);
    }
    // ==================== Logging ====================
    debug(msg, ...args) {
        this.log('DEBUG', msg, args);
    }
    info(msg, ...args) {
        this.log('INFO', msg, args);
    }
    warn(msg, ...args) {
        this.log('WARN', msg, args);
    }
    error(msg, ...args) {
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
    timer(label) {
        const start = performance.now();
        return {
            elapsed: () => performance.now() - start,
            end: (extra) => {
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
    async timed(label, fn) {
        const t = this.timer(label);
        try {
            const result = await fn();
            t.end();
            return result;
        }
        catch (err) {
            const duration = t.elapsed();
            this.error(`⏱ ${label} FALHOU (${formatDuration(duration)})`, err);
            throw err;
        }
    }
    // ==================== Formatação ====================
    log(level, msg, args) {
        if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel])
            return;
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
                if (a instanceof Error)
                    return `\n${DIM}  └─ ${a.stack || a.message}${RESET}`;
                if (typeof a === 'object') {
                    try {
                        return JSON.stringify(a);
                    }
                    catch {
                        return String(a);
                    }
                }
                return String(a);
            }).join(' ');
            fn(`${prefix} ${msg} ${extra}`);
        }
        else {
            fn(`${prefix} ${msg}`);
        }
    }
}
exports.Logger = Logger;
// ==================== Instâncias Pré-configuradas ====================
/** Logger raiz — use logger.child('Modulo') para criar sub-loggers */
const logger = new Logger('App');
// Loggers por módulo (importação direta)
exports.webhookLogger = new Logger('Webhook');
exports.debounceLogger = new Logger('Debounce');
exports.workerLogger = new Logger('Worker');
exports.followUpLogger = new Logger('FollowUp');
exports.queueLogger = new Logger('Queue');
exports.agentLogger = new Logger('Agent');
exports.cronLogger = new Logger('CRON');
exports.bootLogger = new Logger('Boot');
exports.dbLogger = new Logger('DB');
exports.redisLogger = new Logger('Redis');
exports.socketLogger = new Logger('Socket');
exports.evolutionLogger = new Logger('Evolution');
exports.r2Logger = new Logger('R2');
exports.serproLogger = new Logger('Serpro');
exports.default = logger;
//# sourceMappingURL=logger.js.map