"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = require("http");
const webhook_1 = __importDefault(require("./routes/webhook"));
const leads_1 = __importDefault(require("./routes/leads"));
const serpro_api_1 = __importDefault(require("./routes/serpro-api"));
const services_1 = __importDefault(require("./routes/services"));
const admin_1 = __importDefault(require("./routes/admin"));
const atendimento_1 = __importDefault(require("./routes/atendimento"));
const settings_1 = __importDefault(require("./routes/settings"));
const colaboradores_1 = __importDefault(require("./routes/colaboradores"));
const empresas_1 = __importDefault(require("./routes/integra/empresas"));
const robos_1 = __importDefault(require("./routes/integra/robos"));
const message_queue_1 = require("./queues/message-queue");
const message_debounce_1 = require("./queues/message-debounce");
const job_pgmei_1 = require("./queues/integra/job-pgmei");
const job_cnd_1 = require("./queues/integra/job-cnd");
const job_caixa_postal_1 = require("./queues/integra/job-caixa-postal");
const cron_1 = require("./cron");
const socket_server_1 = require("./lib/socket-server");
const evolution_ws_1 = require("./lib/evolution-ws");
const db_1 = __importDefault(require("./lib/db"));
const redis_1 = __importDefault(require("./lib/redis"));
const logger_1 = require("./lib/logger");
const lid_map_1 = require("./lib/lid-map");
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const PORT = parseInt(process.env.PORT || '3001', 10);
// ==================== Middlewares ====================
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// ==================== Rotas ====================
app.use('/api', webhook_1.default);
app.use('/api', leads_1.default);
app.use('/api', serpro_api_1.default);
app.use('/api', services_1.default);
app.use('/api', admin_1.default);
app.use('/api', atendimento_1.default);
app.use('/api', settings_1.default);
app.use('/api', colaboradores_1.default);
app.use('/api', empresas_1.default);
app.use('/api', robos_1.default);
// Root health check
app.get('/', (_req, res) => {
    res.json({
        service: 'Haylander Bot Backend',
        version: '1.0.0',
        status: 'running',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        queues: {
            messageWorker: 'active',
            followUpWorker: 'active',
            debounceWorker: 'active',
        },
        cron: 'registered',
    });
});
// ==================== Inicialização ====================
async function bootstrap() {
    logger_1.bootLogger.info('='.repeat(50));
    logger_1.bootLogger.info('🤖 Haylander Bot Backend v1.0.0');
    logger_1.bootLogger.info(`🔗 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    logger_1.bootLogger.info(`📝 Log Level: ${process.env.LOG_LEVEL || 'INFO'}`);
    logger_1.bootLogger.info('='.repeat(50));
    // 1. Workers BullMQ
    logger_1.bootLogger.info('Iniciando workers BullMQ...');
    const messageWorker = (0, message_queue_1.startMessageWorker)();
    const followUpWorker = (0, message_queue_1.startFollowUpWorker)();
    const debounceWorker = (0, message_debounce_1.startDebounceWorker)();
    const pgmeiWorker = (0, job_pgmei_1.startPgmeiWorker)();
    const cndWorker = (0, job_cnd_1.startCndWorker)();
    const caixaPostalWorker = (0, job_caixa_postal_1.startCaixaPostalWorker)();
    logger_1.bootLogger.info('✅ Workers iniciados (message-sending, follow-up, debounce, integra-pgmei, integra-cnd, integra-caixa-postal)');
    // 1.5 Aquecer cache de mapeamento LID → telefone
    logger_1.bootLogger.info('Aquecendo cache LID...');
    await (0, lid_map_1.warmLidCache)();
    // 2. CRON Jobs
    logger_1.bootLogger.info('Registrando CRON Jobs...');
    (0, cron_1.registerCronJobs)();
    // 3. Socket.io Server (Frontend)
    logger_1.bootLogger.info('Iniciando Socket.io Server (Frontend)...');
    (0, socket_server_1.initSocketServer)(httpServer);
    // 3.5 Evolution API WebSocket (Receiving)
    logger_1.bootLogger.info('Iniciando Cliente WebSocket (Evolution API)...');
    (0, evolution_ws_1.initEvolutionWebSocket)();
    // 4. Express + Socket Server
    httpServer.listen(PORT, '0.0.0.0', () => {
        logger_1.bootLogger.info(`✅ Servidor HTTP + WebSocket rodando em http://0.0.0.0:${PORT}`);
        logger_1.bootLogger.info(`📡 Webhook: http://0.0.0.0:${PORT}/api/webhook/whatsapp`);
        logger_1.bootLogger.info(`🔌 Socket.io: ws://0.0.0.0:${PORT}`);
        logger_1.bootLogger.info(`🏥 Health: http://0.0.0.0:${PORT}/api/health`);
        logger_1.bootLogger.info('🚀 Bot Backend pronto para receber mensagens!');
    });
    // ==================== Graceful Shutdown ====================
    const shutdown = async (signal) => {
        logger_1.bootLogger.info(`Recebido ${signal}. Encerrando gracefully...`);
        try {
            // Esperar workers terminarem jobs em andamento
            await messageWorker.close();
            await followUpWorker.close();
            await debounceWorker.close();
            await pgmeiWorker.close();
            await cndWorker.close();
            await caixaPostalWorker.close();
            logger_1.bootLogger.info('Workers encerrados');
            await db_1.default.end();
            logger_1.bootLogger.info('Conexão com banco de dados encerrada');
            redis_1.default.disconnect();
            logger_1.bootLogger.info('Conexão com o Redis encerrada');
        }
        catch (err) {
            logger_1.bootLogger.error('Erro durante encerramento:', err);
        }
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
bootstrap().catch(err => {
    logger_1.bootLogger.error('Erro fatal na inicialização:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map