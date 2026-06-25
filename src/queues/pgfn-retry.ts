import { Queue, Worker, Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis';
import { enqueueMessages } from './message-queue';
import {
    consultarDividaAtivaPorDevedor,
    isPgfnWindowOpen,
    minutesUntilPgfnOpen,
    PGFN_WINDOW,
} from '../lib/pgfn';
import { cronLogger } from '../lib/logger';

const QUEUE_NAME = 'pgfn-window-retry';
const log = cronLogger;

export interface PgfnRetryJob {
    phone: string;
    cnpj: string;
}

export const pgfnRetryQueue = new Queue(QUEUE_NAME, {
    connection: createRedisConnection() as any,
    defaultJobOptions: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 }, removeOnComplete: true, removeOnFail: 50 },
});

/**
 * Agenda a reconsulta da Dívida Ativa (PGFN) para a próxima abertura da janela (07:05–22:00).
 * jobId fixo por telefone evita agendar duas vezes para o mesmo lead.
 * Margem de +5min após a abertura para não bater exatamente na virada.
 */
export async function schedulePgfnRetry(payload: PgfnRetryJob): Promise<number> {
    const delayMinutes = minutesUntilPgfnOpen() + 5;
    const delayMs = delayMinutes * 60_000;
    await pgfnRetryQueue.add('retry', payload, {
        jobId: `pgfn-retry-${payload.phone}`,
        delay: delayMs,
    });
    log.info(`PGFN retry agendado para ${payload.phone} (CNPJ ${payload.cnpj}) em ~${delayMinutes}min.`);
    return delayMinutes;
}

/** Monta a mensagem do resultado da reconsulta, em linguagem de cliente. */
function buildResultMessage(result: Awaited<ReturnType<typeof consultarDividaAtivaPorDevedor>>): string {
    if (result.tem_debitos_detectado === true) {
        return `🔔 Oi! Voltei aqui — agora dentro do horário, consultei a sua *Dívida Ativa da União (PGFN)*:\n\n⚠️ ${result.resumo.resumo_texto}\n\nPosso te explicar como regularizar essas pendências?`;
    }
    if (result.tem_debitos_detectado === false) {
        return `🔔 Oi! Voltei aqui — agora dentro do horário, consultei a sua *Dívida Ativa da União (PGFN)*:\n\n✅ Sem inscrições em dívida ativa na União. Tudo certo por aqui!`;
    }
    return `🔔 Oi! Tentei reconsultar a sua *Dívida Ativa da União (PGFN)*, mas o sistema da Receita não respondeu agora. Vou tentar de novo e, se persistir, encaminho a um especialista.`;
}

export function startPgfnRetryWorker(): Worker {
    const worker = new Worker<PgfnRetryJob>(
        QUEUE_NAME,
        async (job: Job<PgfnRetryJob>) => {
            const { phone, cnpj } = job.data;

            // Segurança: se ainda fora da janela (servidor reiniciou, fuso, etc.), reagenda.
            if (!isPgfnWindowOpen()) {
                const delayMin = minutesUntilPgfnOpen() + 5;
                await pgfnRetryQueue.add('retry', job.data, { jobId: `pgfn-retry-${phone}`, delay: delayMin * 60_000 });
                log.warn(`PGFN ainda fora do horário ao processar ${phone}; reagendado em ~${delayMin}min.`);
                return;
            }

            const result = await consultarDividaAtivaPorDevedor(cnpj);

            // Se a própria reconsulta caiu fora do horário (borda da janela), reagenda.
            if (result.fora_de_horario) {
                const delayMin = minutesUntilPgfnOpen() + 5;
                await pgfnRetryQueue.add('retry', job.data, { jobId: `pgfn-retry-${phone}`, delay: delayMin * 60_000 });
                log.warn(`PGFN ${cnpj} retornou fora_de_horario na reconsulta de ${phone}; reagendado.`);
                return;
            }

            await enqueueMessages({
                phone,
                messages: [{ content: buildResultMessage(result), type: 'text', delay: 0 }],
                context: 'pgfn-window-retry',
            });
            log.info(`PGFN reconsultada para ${phone} (CNPJ ${cnpj}) — tem_debitos=${result.tem_debitos_detectado}.`);
        },
        { connection: createRedisConnection() as any, concurrency: 3 },
    );

    worker.on('failed', (job, err) => log.error(`PGFN retry falhou (${job?.data?.phone}):`, err));
    log.info(`✅ Worker ${QUEUE_NAME} iniciado (janela ${PGFN_WINDOW.openLabel}–${PGFN_WINDOW.closeLabel}).`);
    return worker;
}
