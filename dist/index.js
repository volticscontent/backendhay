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
const dashboard_1 = __importDefault(require("./routes/integra/dashboard"));
const guias_1 = __importDefault(require("./routes/integra/guias"));
const caixa_postal_1 = __importDefault(require("./routes/integra/caixa-postal"));
const billing_1 = __importDefault(require("./routes/integra/billing"));
const bot_context_1 = __importDefault(require("./routes/bot-context"));
const cnpj_1 = __importDefault(require("./routes/cnpj"));
const message_queue_1 = require("./queues/message-queue");
const message_debounce_1 = require("./queues/message-debounce");
const job_pgmei_1 = require("./queues/integra/job-pgmei");
const job_cnd_1 = require("./queues/integra/job-cnd");
const job_caixa_postal_1 = require("./queues/integra/job-caixa-postal");
const pgfn_retry_1 = require("./queues/pgfn-retry");
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
app.use('/api', dashboard_1.default);
app.use('/api', guias_1.default);
app.use('/api', caixa_postal_1.default);
app.use('/api', billing_1.default);
app.use('/api', bot_context_1.default);
app.use('/api', cnpj_1.default);
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
    // ── Integra Contador: tabelas principais ─────────────────────────────────
    await db_1.default.query(`
        CREATE TABLE IF NOT EXISTS integra_empresas (
            id                    SERIAL PRIMARY KEY,
            cnpj                  VARCHAR(14)  NOT NULL UNIQUE,
            razao_social          TEXT         NOT NULL,
            regime_tributario     VARCHAR(20)  NOT NULL DEFAULT 'mei',
            ativo                 BOOLEAN      NOT NULL DEFAULT true,
            servicos_habilitados  JSONB        NOT NULL DEFAULT '[]',
            lead_id               INTEGER      REFERENCES leads(id) ON DELETE SET NULL,
            certificado_validade  DATE,
            observacoes           TEXT,
            created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS integra_robos (
            tipo_robo        VARCHAR(30)  PRIMARY KEY,
            ativo            BOOLEAN      NOT NULL DEFAULT false,
            dia_execucao     INTEGER      NOT NULL DEFAULT 10,
            hora_execucao    TIME         NOT NULL DEFAULT '08:00',
            ultima_execucao  TIMESTAMPTZ,
            proxima_execucao TIMESTAMPTZ,
            updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );
        INSERT INTO integra_robos (tipo_robo) VALUES ('pgmei'), ('cnd'), ('caixa_postal')
            ON CONFLICT (tipo_robo) DO NOTHING;

        -- Seed empresa teste E2E
        INSERT INTO integra_empresas (cnpj, razao_social, regime_tributario, ativo, servicos_habilitados)
        VALUES ('00000000000191', 'EMPRESA MOCK E2E - BANCO DO BRASIL', 'mei', true, '["PGMEI", "CND"]')
        ON CONFLICT (cnpj) DO NOTHING;

        CREATE TABLE IF NOT EXISTS integra_execucoes (
            id              SERIAL PRIMARY KEY,
            robo_tipo       VARCHAR(30)  NOT NULL,
            status          VARCHAR(20)  NOT NULL DEFAULT 'running',
            total_empresas  INTEGER      DEFAULT 0,
            sucesso         INTEGER      DEFAULT 0,
            falhas          INTEGER      DEFAULT 0,
            ignoradas       INTEGER      DEFAULT 0,
            iniciado_em     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            concluido_em    TIMESTAMPTZ,
            duracao_ms      INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_integra_exec_robo ON integra_execucoes(robo_tipo, iniciado_em DESC);

        CREATE TABLE IF NOT EXISTS integra_execucao_itens (
            id            SERIAL PRIMARY KEY,
            execucao_id   INTEGER      NOT NULL REFERENCES integra_execucoes(id) ON DELETE CASCADE,
            empresa_id    INTEGER      NOT NULL REFERENCES integra_empresas(id)  ON DELETE CASCADE,
            status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
            dados_resposta JSONB,
            mensagem      TEXT,
            custo_estimado DECIMAL(10, 4),
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS integra_guias (
            id               SERIAL PRIMARY KEY,
            empresa_id       INTEGER      NOT NULL REFERENCES integra_empresas(id) ON DELETE CASCADE,
            tipo             VARCHAR(30)  NOT NULL DEFAULT 'das_mei',
            competencia      VARCHAR(6),
            valor            DECIMAL(12, 2),
            vencimento       DATE,
            codigo_barras    TEXT,
            dados_originais  JSONB,
            status_pagamento VARCHAR(20)  NOT NULL DEFAULT 'pendente',
            pdf_r2_key       TEXT,
            created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            UNIQUE (empresa_id, tipo, competencia)
        );

        CREATE TABLE IF NOT EXISTS integra_caixa_postal (
            id             SERIAL PRIMARY KEY,
            empresa_id     INTEGER      NOT NULL REFERENCES integra_empresas(id) ON DELETE CASCADE,
            assunto        TEXT,
            conteudo       TEXT,
            data_mensagem  TIMESTAMPTZ,
            dados_originais JSONB,
            lida           BOOLEAN      NOT NULL DEFAULT false,
            created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            UNIQUE (empresa_id, assunto, data_mensagem)
        );
    `);
    // ── integra_precos — tabela de preços Serpro por robô (Billing) ──────────
    await db_1.default.query(`
        CREATE TABLE IF NOT EXISTS integra_precos (
            id            SERIAL PRIMARY KEY,
            tipo_robo     VARCHAR(30) NOT NULL UNIQUE,
            preco_unitario DECIMAL(10, 4) NOT NULL DEFAULT 0,
            descricao     TEXT,
            updated_at    TIMESTAMPTZ DEFAULT NOW()
        );
        INSERT INTO integra_precos (tipo_robo, preco_unitario, descricao) VALUES
            ('pgmei',        0.05, 'PGMEI — por empresa consultada'),
            ('pgdas',        0.05, 'PGDAS — por empresa consultada'),
            ('cnd',          0.10, 'CND — por empresa consultada'),
            ('caixa_postal', 0.03, 'Caixa Postal — por empresa consultada')
        ON CONFLICT (tipo_robo) DO NOTHING;

        ALTER TABLE integra_execucao_itens
            ADD COLUMN IF NOT EXISTS custo_estimado DECIMAL(10, 4);
    `);
    await db_1.default.query(`
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
    // ── Multi-empresa: tabela lead_empresa (migration 016 — substituiu cnpjs_adicionais/cnpj_ativo) ──
    await db_1.default.query(`
        CREATE TABLE IF NOT EXISTS lead_empresa (
            id                  SERIAL PRIMARY KEY,
            lead_id             INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
            cnpj                VARCHAR(18) NOT NULL,
            tipo_vinculo        VARCHAR(20) NOT NULL DEFAULT 'proprietario'
                                CHECK (tipo_vinculo IN ('proprietario', 'socio', 'representante')),
            razao_social        VARCHAR(255),
            tipo_negocio        VARCHAR(100),
            faturamento_mensal  VARCHAR(50),
            procuracao          BOOLEAN DEFAULT FALSE,
            procuracao_ativa    BOOLEAN DEFAULT FALSE,
            procuracao_validade DATE,
            tem_divida          BOOLEAN,
            valor_divida_pgfn   NUMERIC(12,2),
            valor_divida_municipal NUMERIC(12,2),
            valor_divida_estadual  NUMERIC(12,2),
            valor_divida_federal   NUMERIC(12,2),
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            updated_at          TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (lead_id, cnpj)
        );
        CREATE INDEX IF NOT EXISTS idx_lead_empresa_lead_id ON lead_empresa(lead_id);
        CREATE INDEX IF NOT EXISTS idx_lead_empresa_cnpj    ON lead_empresa(cnpj);
    `);
    // ── Fix: video_ecac era type='media' mas valor é URL do Instagram ─────────
    await db_1.default.query(`
        UPDATE system_settings
        SET type = 'link', updated_at = NOW()
        WHERE key = 'video_ecac' AND type = 'media';
    `);
    // ── Regime tributário no lead (coletado conversacionalmente pelo Apolo) ──
    // O Apolo chama update_user(regime=...); sem esta coluna a escrita era descartada.
    await db_1.default.query(`
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS regime VARCHAR(20);
    `);
    // ── Lead único por telefone (rede de segurança no banco) ──
    // Impede um 2º perfil com o mesmo número (createUser já é idempotente em código).
    // Índice parcial: ignora telefones nulos. Não falha se já houver duplicados (apenas loga).
    try {
        await db_1.default.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS leads_telefone_uniq
            ON leads (telefone) WHERE telefone IS NOT NULL;
        `);
    }
    catch (err) {
        logger_1.bootLogger.warn('Não foi possível criar índice único leads(telefone) — verifique duplicados:', err);
    }
}
// ==================== Inicialização ====================
async function bootstrap() {
    logger_1.bootLogger.info('='.repeat(50));
    logger_1.bootLogger.info('🤖 Haylander Bot Backend v1.0.0');
    logger_1.bootLogger.info(`🔗 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    logger_1.bootLogger.info(`📝 Log Level: ${process.env.LOG_LEVEL || 'INFO'}`);
    logger_1.bootLogger.info('='.repeat(50));
    // 0. Migrations
    logger_1.bootLogger.info('Executando migrations...');
    await runMigrations();
    logger_1.bootLogger.info('✅ Migrations aplicadas');
    // 1. Workers BullMQ
    logger_1.bootLogger.info('Iniciando workers BullMQ...');
    const messageWorker = (0, message_queue_1.startMessageWorker)();
    const followUpWorker = (0, message_queue_1.startFollowUpWorker)();
    const debounceWorker = (0, message_debounce_1.startDebounceWorker)();
    const pgmeiWorker = (0, job_pgmei_1.startPgmeiWorker)();
    const cndWorker = (0, job_cnd_1.startCndWorker)();
    const caixaPostalWorker = (0, job_caixa_postal_1.startCaixaPostalWorker)();
    const pgfnRetryWorker = (0, pgfn_retry_1.startPgfnRetryWorker)();
    logger_1.bootLogger.info('✅ Workers iniciados (message-sending, follow-up, debounce, integra-pgmei, integra-cnd, integra-caixa-postal, pgfn-window-retry)');
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