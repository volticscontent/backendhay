import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import webhookRoutes from './routes/webhook';
import { startMessageWorker, startFollowUpWorker } from './queues/message-queue';
import { registerCronJobs } from './cron';
import pool from './lib/db';
import redis from './lib/redis';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// ==================== Middlewares ====================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==================== Rotas ====================
app.use('/api', webhookRoutes);

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
    const messageWorker = startMessageWorker();
    const followUpWorker = startFollowUpWorker();
    console.log('[Boot] ✅ Workers iniciados (message-sending, follow-up)');

    // 2. CRON Jobs
    console.log('\n[Boot] Registrando CRON Jobs...');
    registerCronJobs();

    // 3. Express Server
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n[Boot] ✅ Servidor HTTP rodando em http://0.0.0.0:${PORT}`);
        console.log(`[Boot] 📡 Webhook endpoint: http://0.0.0.0:${PORT}/api/webhook/whatsapp`);
        console.log(`[Boot] 🏥 Health check: http://0.0.0.0:${PORT}/api/health`);
        console.log('\n[Boot] 🚀 Bot Backend pronto para receber mensagens!\n');
    });

    // ==================== Graceful Shutdown ====================
    const shutdown = async (signal: string) => {
        console.log(`\n[Shutdown] Recebido ${signal}. Encerrando gracefully...`);

        try {
            // Esperar workers terminarem jobs em andamento
            await messageWorker.close();
            await followUpWorker.close();
            console.log('[Shutdown] Workers encerrados');

            await pool.end();
            console.log('[Shutdown] Conexão com banco de dados encerrada');

            redis.disconnect();
            console.log('[Shutdown] Conexão com o Redis encerrada');
        } catch (err) {
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
