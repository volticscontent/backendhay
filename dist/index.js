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
const message_queue_1 = require("./queues/message-queue");
const cron_1 = require("./cron");
const socket_server_1 = require("./lib/socket-server");
const db_1 = __importDefault(require("./lib/db"));
const redis_1 = __importDefault(require("./lib/redis"));
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const PORT = parseInt(process.env.PORT || '3001', 10);
// ==================== Middlewares ====================
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// ==================== Rotas ====================
app.use('/api', webhook_1.default);
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
        },
        cron: 'registered',
    });
});
// ==================== Inicialização ====================
async function bootstrap() {
    console.log('='.repeat(60));
    console.log('  🤖 Haylander Bot Backend');
    console.log('  📦 Versão: 1.0.0');
    console.log('  🔗 Ambiente:', process.env.NODE_ENV || 'development');
    console.log('='.repeat(60));
    // 1. Workers BullMQ
    console.log('\n[Boot] Iniciando workers BullMQ...');
    const messageWorker = (0, message_queue_1.startMessageWorker)();
    const followUpWorker = (0, message_queue_1.startFollowUpWorker)();
    console.log('[Boot] ✅ Workers iniciados (message-sending, follow-up)');
    // 2. CRON Jobs
    console.log('\n[Boot] Registrando CRON Jobs...');
    (0, cron_1.registerCronJobs)();
    // 3. Socket.io Server
    console.log('\n[Boot] Iniciando Socket.io Server...');
    (0, socket_server_1.initSocketServer)(httpServer);
    // 4. Express + Socket Server
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`\n[Boot] ✅ Servidor HTTP + WebSocket rodando em http://0.0.0.0:${PORT}`);
        console.log(`[Boot] 📡 Webhook endpoint: http://0.0.0.0:${PORT}/api/webhook/whatsapp`);
        console.log(`[Boot] 🔌 Socket.io: ws://0.0.0.0:${PORT}`);
        console.log(`[Boot] 🏥 Health check: http://0.0.0.0:${PORT}/api/health`);
        console.log('\n[Boot] 🚀 Bot Backend pronto para receber mensagens!\n');
    });
    // ==================== Graceful Shutdown ====================
    const shutdown = async (signal) => {
        console.log(`\n[Shutdown] Recebido ${signal}. Encerrando gracefully...`);
        try {
            // Esperar workers terminarem jobs em andamento
            await messageWorker.close();
            await followUpWorker.close();
            console.log('[Shutdown] Workers encerrados');
            await db_1.default.end();
            console.log('[Shutdown] Conexão com banco de dados encerrada');
            redis_1.default.disconnect();
            console.log('[Shutdown] Conexão com o Redis encerrada');
        }
        catch (err) {
            console.error('[Shutdown] Erro durante encerramento gracioso:', err);
        }
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
bootstrap().catch(err => {
    console.error('[Fatal] Erro na inicialização:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map