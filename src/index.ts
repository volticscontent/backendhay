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
import intregraDashboardRoutes from './routes/integra/dashboard';
import integraGuiasRoutes from './routes/integra/guias';
import intregraCaixaPostalRoutes from './routes/integra/caixa-postal';
import intregraBillingRoutes from './routes/integra/billing';
import botContextRoutes from './routes/bot-context';
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
app.use('/api', intregraDashboardRoutes);
app.use('/api', integraGuiasRoutes);
app.use('/api', intregraCaixaPostalRoutes);
app.use('/api', intregraBillingRoutes);
app.use('/api', botContextRoutes);

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

async function runMigrations() {
    // integra_precos — tabela de preços Serpro por robô (Fase 4 Billing)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS integra_precos (
            id            SERIAL PRIMARY KEY,
            tipo_robo     VARCHAR(30) NOT NULL UNIQUE,
            preco_unitario DECIMAL(10, 4) NOT NULL DEFAULT 0,
            descricao     TEXT,
            updated_at    TIMESTAMPTZ DEFAULT NOW()
        );
        -- Seed preços padrão (estimativa — ajustar conforme contrato Serpro)
        INSERT INTO integra_precos (tipo_robo, preco_unitario, descricao) VALUES
            ('pgmei',        0.05, 'PGMEI — por empresa consultada'),
            ('pgdas',        0.05, 'PGDAS — por empresa consultada'),
            ('cnd',          0.10, 'CND — por empresa consultada'),
            ('caixa_postal', 0.03, 'Caixa Postal — por empresa consultada')
        ON CONFLICT (tipo_robo) DO NOTHING;

        -- custo_estimado em integra_execucao_itens (caso não exista ainda)
        ALTER TABLE integra_execucao_itens
            ADD COLUMN IF NOT EXISTS custo_estimado DECIMAL(10, 4);
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS serpro_documentos (
            id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            cnpj          VARCHAR(14)  NOT NULL,
            tipo_servico  VARCHAR(50)  NOT NULL,
            protocolo     VARCHAR(100),
            r2_key        TEXT         NOT NULL,
            r2_url        TEXT         NOT NULL,
            tamanho_bytes INTEGER,
            valido_ate    TIMESTAMPTZ,
            gerado_por    VARCHAR(20)  NOT NULL DEFAULT 'admin',
            lead_id       INTEGER      REFERENCES leads(id) ON DELETE SET NULL,
            metadata      JSONB,
            deletado_em   TIMESTAMPTZ,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_serpro_docs_cnpj   ON serpro_documentos(cnpj);
        CREATE INDEX IF NOT EXISTS idx_serpro_docs_tipo   ON serpro_documentos(tipo_servico);
        CREATE INDEX IF NOT EXISTS idx_serpro_docs_valido ON serpro_documentos(valido_ate) WHERE deletado_em IS NULL;
    `);
}

// ==================== Inicialização ====================
async function bootstrap() {
    bootLogger.info('='.repeat(50));
    bootLogger.info('🤖 Haylander Bot Backend v1.0.0');
    bootLogger.info(`🔗 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    bootLogger.info(`📝 Log Level: ${process.env.LOG_LEVEL || 'INFO'}`);
    bootLogger.info('='.repeat(50));

    // 0. Migrations
    bootLogger.info('Executando migrations...');
    await runMigrations();
    bootLogger.info('✅ Migrations aplicadas');

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
