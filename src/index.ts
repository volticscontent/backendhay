import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import webhookRoutes from './routes/webhook';
import leadsRoutes from './routes/leads';
import serproRoutes from './routes/serpro-api';
import servicesRoutes from './routes/services';
import adminRoutes from './routes/admin';
import atendimentoRoutes from './routes/atendimento';
import settingsRoutes from './routes/settings';
import colaboradoresRoutes from './routes/colaboradores';
import integraEmpresasRoutes from './routes/integra/empresas';
import integraRobosRoutes from './routes/integra/robos';
import { startMessageWorker, startFollowUpWorker } from './queues/message-queue';
import { startDebounceWorker } from './queues/message-debounce';
import { startPgmeiWorker } from './queues/integra/job-pgmei';
import { startCndWorker } from './queues/integra/job-cnd';
import { startCaixaPostalWorker } from './queues/integra/job-caixa-postal';
import { registerCronJobs } from './cron';
import { initSocketServer } from './lib/socket-server';
import { initEvolutionWebSocket } from './lib/evolution-ws';
import pool from './lib/db';
import redis from './lib/redis';
import { bootLogger } from './lib/logger';
import { warmLidCache } from './lib/lid-map';

const app = express();
const httpServer = createServer(app);
const PORT = parseInt(process.env.PORT || '3001', 10);

// ==================== Middlewares ====================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==================== Rotas ====================
app.use('/api', webhookRoutes);
app.use('/api', leadsRoutes);
app.use('/api', serproRoutes);
app.use('/api', servicesRoutes);
app.use('/api', adminRoutes);
app.use('/api', atendimentoRoutes);
app.use('/api', settingsRoutes);
app.use('/api', colaboradoresRoutes);
app.use('/api', integraEmpresasRoutes);
app.use('/api', integraRobosRoutes);

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
    bootLogger.info('='.repeat(50));
    bootLogger.info('🤖 Haylander Bot Backend v1.0.0');
    bootLogger.info(`🔗 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    bootLogger.info(`📝 Log Level: ${process.env.LOG_LEVEL || 'INFO'}`);
    bootLogger.info('='.repeat(50));

    // 1. Workers BullMQ
    bootLogger.info('Iniciando workers BullMQ...');
    const messageWorker = startMessageWorker();
    const followUpWorker = startFollowUpWorker();
    const debounceWorker = startDebounceWorker();
    const pgmeiWorker = startPgmeiWorker();
    const cndWorker = startCndWorker();
    const caixaPostalWorker = startCaixaPostalWorker();
    bootLogger.info('✅ Workers iniciados (message-sending, follow-up, debounce, integra-pgmei, integra-cnd, integra-caixa-postal)');

    // 1.5 Aquecer cache de mapeamento LID → telefone
    bootLogger.info('Aquecendo cache LID...');
    await warmLidCache();

    // 2. CRON Jobs
    bootLogger.info('Registrando CRON Jobs...');
    registerCronJobs();

    // 3. Socket.io Server (Frontend)
    bootLogger.info('Iniciando Socket.io Server (Frontend)...');
    initSocketServer(httpServer);

    // 3.5 Evolution API WebSocket (Receiving)
    bootLogger.info('Iniciando Cliente WebSocket (Evolution API)...');
    initEvolutionWebSocket();

    // 4. Express + Socket Server
    httpServer.listen(PORT, '0.0.0.0', () => {
        bootLogger.info(`✅ Servidor HTTP + WebSocket rodando em http://0.0.0.0:${PORT}`);
        bootLogger.info(`📡 Webhook: http://0.0.0.0:${PORT}/api/webhook/whatsapp`);
        bootLogger.info(`🔌 Socket.io: ws://0.0.0.0:${PORT}`);
        bootLogger.info(`🏥 Health: http://0.0.0.0:${PORT}/api/health`);
        bootLogger.info('🚀 Bot Backend pronto para receber mensagens!');
    });

    // ==================== Graceful Shutdown ====================
    const shutdown = async (signal: string) => {
        bootLogger.info(`Recebido ${signal}. Encerrando gracefully...`);

        try {
            // Esperar workers terminarem jobs em andamento
            await messageWorker.close();
            await followUpWorker.close();
            await debounceWorker.close();
            await pgmeiWorker.close();
            await cndWorker.close();
            await caixaPostalWorker.close();
            bootLogger.info('Workers encerrados');

            await pool.end();
            bootLogger.info('Conexão com banco de dados encerrada');

            redis.disconnect();
            bootLogger.info('Conexão com o Redis encerrada');
        } catch (err) {
            bootLogger.error('Erro durante encerramento:', err);
        }

        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch(err => {
    bootLogger.error('Erro fatal na inicialização:', err);
    process.exit(1);
});
