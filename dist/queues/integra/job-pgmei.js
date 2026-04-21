"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pgmeiQueue = void 0;
exports.startPgmeiWorker = startPgmeiWorker;
exports.enqueueRoboPgmei = enqueueRoboPgmei;
const bullmq_1 = require("bullmq");
const redis_1 = require("../../lib/redis");
const db_1 = require("../../lib/db");
const serpro_1 = require("../../lib/serpro");
const logger_1 = require("../../lib/logger");
const QUEUE_NAME = 'integra-pgmei';
const CONCURRENCY = 3;
exports.pgmeiQueue = new bullmq_1.Queue(QUEUE_NAME, {
    connection: (0, redis_1.createRedisConnection)(),
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 * 24 },
        removeOnFail: { age: 3600 * 24 * 7 },
    },
});
async function processEmpresa(execucaoId, empresaId, cnpj) {
    try {
        const result = await (0, serpro_1.consultarServico)('PGMEI', cnpj);
        await (0, db_1.query)(`INSERT INTO integra_execucao_itens (execucao_id, empresa_id, status, dados_resposta)
             VALUES ($1, $2, 'success', $3)`, [execucaoId, empresaId, JSON.stringify(result)]);
        // Persistir guia se houver dados de pagamento
        const r = result;
        if (r.valorPrincipal || r.valor || r.codigoBarras) {
            const hoje = new Date();
            const competencia = `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}`;
            await (0, db_1.query)(`INSERT INTO integra_guias
                   (empresa_id, tipo, competencia, valor, vencimento, codigo_barras, dados_originais)
                 VALUES ($1, 'das_mei', $2, $3, $4, $5, $6)
                 ON CONFLICT DO NOTHING`, [
                empresaId, competencia,
                r.valorPrincipal ?? r.valor ?? null,
                r.dataVencimento ?? null,
                r.codigoBarras ?? null,
                JSON.stringify(result),
            ]);
        }
        return 'success';
    }
    catch (err) {
        const msg = err?.message ?? String(err);
        await (0, db_1.query)(`INSERT INTO integra_execucao_itens (execucao_id, empresa_id, status, mensagem)
             VALUES ($1, $2, 'error', $3)`, [execucaoId, empresaId, msg]);
        return 'error';
    }
}
function startPgmeiWorker() {
    const worker = new bullmq_1.Worker(QUEUE_NAME, async (job) => {
        const { execucaoId } = job.data;
        const log = logger_1.cronLogger;
        const empresas = await (0, db_1.query)(`SELECT id, cnpj FROM integra_empresas
                 WHERE ativo = true
                   AND servicos_habilitados ? 'PGMEI'`);
        const total = empresas.rows.length;
        let sucesso = 0, falhas = 0, ignoradas = 0;
        await (0, db_1.query)(`UPDATE integra_execucoes SET total_empresas = $1 WHERE id = $2`, [total, execucaoId]);
        // Processar em lotes de CONCURRENCY
        for (let i = 0; i < empresas.rows.length; i += CONCURRENCY) {
            const lote = empresas.rows.slice(i, i + CONCURRENCY);
            const resultados = await Promise.all(lote.map(e => processEmpresa(execucaoId, e.id, e.cnpj)));
            for (const r of resultados) {
                if (r === 'success')
                    sucesso++;
                else if (r === 'error')
                    falhas++;
                else
                    ignoradas++;
            }
            // Backoff entre lotes para evitar throttle do Serpro
            if (i + CONCURRENCY < empresas.rows.length) {
                await new Promise(res => setTimeout(res, 1500));
            }
        }
        const concluido = new Date();
        await (0, db_1.query)(`UPDATE integra_execucoes
                 SET status = $1, concluido_em = $2, sucesso = $3, falhas = $4, ignoradas = $5,
                     duracao_ms = EXTRACT(EPOCH FROM ($2 - iniciado_em)) * 1000
                 WHERE id = $6`, [falhas === 0 ? 'completed' : sucesso > 0 ? 'partial' : 'failed',
            concluido, sucesso, falhas, ignoradas, execucaoId]);
        log.info(`[PGMEI] Execução ${execucaoId} finalizada — ${sucesso} ok, ${falhas} erros`);
    }, { connection: (0, redis_1.createRedisConnection)(), concurrency: 1 });
    worker.on('failed', (job, err) => logger_1.cronLogger.error(`[PGMEI] Job falhou:`, err));
    return worker;
}
async function enqueueRoboPgmei(execucaoId) {
    await exports.pgmeiQueue.add('run', { execucaoId }, { jobId: `pgmei-${execucaoId}` });
}
//# sourceMappingURL=job-pgmei.js.map