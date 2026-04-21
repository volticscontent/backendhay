"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cndQueue = void 0;
exports.startCndWorker = startCndWorker;
exports.enqueueRoboCnd = enqueueRoboCnd;
const bullmq_1 = require("bullmq");
const redis_1 = require("../../lib/redis");
const db_1 = require("../../lib/db");
const serpro_1 = require("../../lib/serpro");
const logger_1 = require("../../lib/logger");
const QUEUE_NAME = 'integra-cnd';
const CONCURRENCY = 3;
exports.cndQueue = new bullmq_1.Queue(QUEUE_NAME, {
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
        const result = await (0, serpro_1.consultarServico)('CND', cnpj);
        await (0, db_1.query)(`INSERT INTO integra_execucao_itens (execucao_id, empresa_id, status, dados_resposta)
             VALUES ($1, $2, 'success', $3)`, [execucaoId, empresaId, JSON.stringify(result)]);
        return 'success';
    }
    catch (err) {
        await (0, db_1.query)(`INSERT INTO integra_execucao_itens (execucao_id, empresa_id, status, mensagem)
             VALUES ($1, $2, 'error', $3)`, [execucaoId, empresaId, err?.message ?? String(err)]);
        return 'error';
    }
}
function startCndWorker() {
    const worker = new bullmq_1.Worker(QUEUE_NAME, async (job) => {
        const { execucaoId } = job.data;
        const empresas = await (0, db_1.query)(`SELECT id, cnpj FROM integra_empresas
                 WHERE ativo = true AND servicos_habilitados ? 'CND'`);
        const total = empresas.rows.length;
        let sucesso = 0, falhas = 0;
        await (0, db_1.query)(`UPDATE integra_execucoes SET total_empresas = $1 WHERE id = $2`, [total, execucaoId]);
        for (let i = 0; i < empresas.rows.length; i += CONCURRENCY) {
            const lote = empresas.rows.slice(i, i + CONCURRENCY);
            const resultados = await Promise.all(lote.map(e => processEmpresa(execucaoId, e.id, e.cnpj)));
            for (const r of resultados) {
                if (r === 'success')
                    sucesso++;
                else
                    falhas++;
            }
            if (i + CONCURRENCY < empresas.rows.length) {
                await new Promise(res => setTimeout(res, 1500));
            }
        }
        await (0, db_1.query)(`UPDATE integra_execucoes
                 SET status = $1, concluido_em = NOW(), sucesso = $2, falhas = $3,
                     duracao_ms = EXTRACT(EPOCH FROM (NOW() - iniciado_em)) * 1000
                 WHERE id = $4`, [falhas === 0 ? 'completed' : sucesso > 0 ? 'partial' : 'failed', sucesso, falhas, execucaoId]);
        logger_1.cronLogger.info(`[CND] Execução ${execucaoId} — ${sucesso} ok, ${falhas} erros`);
    }, { connection: (0, redis_1.createRedisConnection)(), concurrency: 1 });
    worker.on('failed', (_job, err) => logger_1.cronLogger.error('[CND] Job falhou:', err));
    return worker;
}
async function enqueueRoboCnd(execucaoId) {
    await exports.cndQueue.add('run', { execucaoId }, { jobId: `cnd-${execucaoId}` });
}
//# sourceMappingURL=job-cnd.js.map