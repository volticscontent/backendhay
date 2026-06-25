"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pgfnRetryQueue = void 0;
exports.schedulePgfnRetry = schedulePgfnRetry;
exports.startPgfnRetryWorker = startPgfnRetryWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../lib/redis");
const message_queue_1 = require("./message-queue");
const pgfn_1 = require("../lib/pgfn");
const logger_1 = require("../lib/logger");
const QUEUE_NAME = 'pgfn-window-retry';
const log = logger_1.cronLogger;
exports.pgfnRetryQueue = new bullmq_1.Queue(QUEUE_NAME, {
    connection: (0, redis_1.createRedisConnection)(),
    defaultJobOptions: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 }, removeOnComplete: true, removeOnFail: 50 },
});
/**
 * Agenda a reconsulta da Dívida Ativa (PGFN) para a próxima abertura da janela (07:05–22:00).
 * jobId fixo por telefone evita agendar duas vezes para o mesmo lead.
 * Margem de +5min após a abertura para não bater exatamente na virada.
 */
async function schedulePgfnRetry(payload) {
    const delayMinutes = (0, pgfn_1.minutesUntilPgfnOpen)() + 5;
    const delayMs = delayMinutes * 60_000;
    await exports.pgfnRetryQueue.add('retry', payload, {
        jobId: `pgfn-retry-${payload.phone}`,
        delay: delayMs,
    });
    log.info(`PGFN retry agendado para ${payload.phone} (CNPJ ${payload.cnpj}) em ~${delayMinutes}min.`);
    return delayMinutes;
}
/** Monta a mensagem do resultado da reconsulta, em linguagem de cliente. */
function buildResultMessage(result) {
    if (result.tem_debitos_detectado === true) {
        return `🔔 Oi! Voltei aqui — agora dentro do horário, consultei a sua *Dívida Ativa da União (PGFN)*:\n\n⚠️ ${result.resumo.resumo_texto}\n\nPosso te explicar como regularizar essas pendências?`;
    }
    if (result.tem_debitos_detectado === false) {
        return `🔔 Oi! Voltei aqui — agora dentro do horário, consultei a sua *Dívida Ativa da União (PGFN)*:\n\n✅ Sem inscrições em dívida ativa na União. Tudo certo por aqui!`;
    }
    return `🔔 Oi! Tentei reconsultar a sua *Dívida Ativa da União (PGFN)*, mas o sistema da Receita não respondeu agora. Vou tentar de novo e, se persistir, encaminho a um especialista.`;
}
function startPgfnRetryWorker() {
    const worker = new bullmq_1.Worker(QUEUE_NAME, async (job) => {
        const { phone, cnpj } = job.data;
        // Segurança: se ainda fora da janela (servidor reiniciou, fuso, etc.), reagenda.
        if (!(0, pgfn_1.isPgfnWindowOpen)()) {
            const delayMin = (0, pgfn_1.minutesUntilPgfnOpen)() + 5;
            await exports.pgfnRetryQueue.add('retry', job.data, { jobId: `pgfn-retry-${phone}`, delay: delayMin * 60_000 });
            log.warn(`PGFN ainda fora do horário ao processar ${phone}; reagendado em ~${delayMin}min.`);
            return;
        }
        const result = await (0, pgfn_1.consultarDividaAtivaPorDevedor)(cnpj);
        // Se a própria reconsulta caiu fora do horário (borda da janela), reagenda.
        if (result.fora_de_horario) {
            const delayMin = (0, pgfn_1.minutesUntilPgfnOpen)() + 5;
            await exports.pgfnRetryQueue.add('retry', job.data, { jobId: `pgfn-retry-${phone}`, delay: delayMin * 60_000 });
            log.warn(`PGFN ${cnpj} retornou fora_de_horario na reconsulta de ${phone}; reagendado.`);
            return;
        }
        await (0, message_queue_1.enqueueMessages)({
            phone,
            messages: [{ content: buildResultMessage(result), type: 'text', delay: 0 }],
            context: 'pgfn-window-retry',
        });
        log.info(`PGFN reconsultada para ${phone} (CNPJ ${cnpj}) — tem_debitos=${result.tem_debitos_detectado}.`);
    }, { connection: (0, redis_1.createRedisConnection)(), concurrency: 3 });
    worker.on('failed', (job, err) => log.error(`PGFN retry falhou (${job?.data?.phone}):`, err));
    log.info(`✅ Worker ${QUEUE_NAME} iniciado (janela ${pgfn_1.PGFN_WINDOW.openLabel}–${pgfn_1.PGFN_WINDOW.closeLabel}).`);
    return worker;
}
//# sourceMappingURL=pgfn-retry.js.map