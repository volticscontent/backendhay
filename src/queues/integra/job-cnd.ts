import { Queue, Worker, Job } from 'bullmq';
import { createRedisConnection } from '../../lib/redis';
import { query } from '../../lib/db';
import { consultarServico } from '../../lib/serpro';
import { cronLogger } from '../../lib/logger';

const QUEUE_NAME = 'integra-cnd';
const CONCURRENCY = 3;

export const cndQueue = new Queue(QUEUE_NAME, {
    connection: createRedisConnection() as any,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 * 24 },
        removeOnFail: { age: 3600 * 24 * 7 },
    },
});

async function processEmpresa(execucaoId: number, empresaId: number, cnpj: string): Promise<'success' | 'error'> {
    try {
        const result = await consultarServico('CND', cnpj);
        await query(
            `INSERT INTO integra_execucao_itens (execucao_id, empresa_id, status, dados_resposta)
             VALUES ($1, $2, 'success', $3)`,
            [execucaoId, empresaId, JSON.stringify(result)]
        );
        return 'success';
    } catch (err: any) {
        await query(
            `INSERT INTO integra_execucao_itens (execucao_id, empresa_id, status, mensagem)
             VALUES ($1, $2, 'error', $3)`,
            [execucaoId, empresaId, err?.message ?? String(err)]
        );
        return 'error';
    }
}

export function startCndWorker() {
    const worker = new Worker(
        QUEUE_NAME,
        async (job: Job) => {
            const { execucaoId } = job.data as { execucaoId: number };

            const empresas = await query(
                `SELECT id, cnpj FROM integra_empresas
                 WHERE ativo = true AND servicos_habilitados ? 'CND'`
            );

            const total = empresas.rows.length;
            let sucesso = 0, falhas = 0;
            await query(`UPDATE integra_execucoes SET total_empresas = $1 WHERE id = $2`, [total, execucaoId]);

            for (let i = 0; i < empresas.rows.length; i += CONCURRENCY) {
                const lote = empresas.rows.slice(i, i + CONCURRENCY);
                const resultados = await Promise.all(
                    lote.map(e => processEmpresa(execucaoId, e.id as number, e.cnpj as string))
                );
                for (const r of resultados) { if (r === 'success') sucesso++; else falhas++; }
                if (i + CONCURRENCY < empresas.rows.length) {
                    await new Promise(res => setTimeout(res, 1500));
                }
            }

            await query(
                `UPDATE integra_execucoes
                 SET status = $1, concluido_em = NOW(), sucesso = $2, falhas = $3,
                     duracao_ms = EXTRACT(EPOCH FROM (NOW() - iniciado_em)) * 1000
                 WHERE id = $4`,
                [falhas === 0 ? 'completed' : sucesso > 0 ? 'partial' : 'failed', sucesso, falhas, execucaoId]
            );

            cronLogger.info(`[CND] Execução ${execucaoId} — ${sucesso} ok, ${falhas} erros`);
        },
        { connection: createRedisConnection() as any, concurrency: 1 }
    );

    worker.on('failed', (_job, err) => cronLogger.error('[CND] Job falhou:', err));
    return worker;
}

export async function enqueueRoboCnd(execucaoId: number) {
    await cndQueue.add('run', { execucaoId }, { jobId: `cnd-${execucaoId}` });
}
