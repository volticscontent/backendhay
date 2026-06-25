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
// Pequena folga para o aviso chegar logo DEPOIS da resposta do Apolo (que é enfileirada na hora),
// lendo como um follow-up natural em vez de competir com a mensagem do resultado do PGMEI.
const NOTICE_DELAY_MS = 8_000;
/** Aviso determinístico ao cliente de que a Dívida Ativa será consultada na próxima janela. */
function buildWindowNoticeMessage() {
    const quando = (0, pgfn_1.nextPgfnWindowDescription)();
    return (`📌 Só um detalhe sobre a *Dívida Ativa da União (PGFN)*: essa consulta só fica disponível ` +
        `em horário comercial (das ${pgfn_1.PGFN_WINDOW.openLabel} às ${pgfn_1.PGFN_WINDOW.closeLabel}). ` +
        `Já deixei agendado e vou fazer a verificação automaticamente ${quando} — ` +
        `assim que tiver o resultado, te trago aqui com o valor exato. 👍`);
}
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
    const jobId = `pgfn-retry-${payload.phone}`;
    const delayMinutes = (0, pgfn_1.minutesUntilPgfnOpen)() + 5;
    // Se já existe retry agendado para este telefone (ex.: PGMEI e Dívida Ativa consultadas no mesmo
    // atendimento), não reagenda nem reavisa — o cliente já foi informado uma vez.
    const existing = await exports.pgfnRetryQueue.getJob(jobId);
    if (existing) {
        log.info(`PGFN retry já agendado para ${payload.phone}; não reagenda nem reavisa.`);
        return delayMinutes;
    }
    await exports.pgfnRetryQueue.add('retry', payload, { jobId, delay: delayMinutes * 60_000 });
    // Avisa o cliente DE FORMA DETERMINÍSTICA (não depende do LLM) que a Dívida Ativa será
    // consultada na próxima janela e o resultado virá por aqui — com o valor devido exato.
    await (0, message_queue_1.scheduleFollowUp)(payload.phone, buildWindowNoticeMessage(), NOTICE_DELAY_MS, 'reminder', {
        kind: 'pgfn-window-confirm',
        cnpj: payload.cnpj,
    }).catch(err => log.error(`Falha ao avisar ${payload.phone} sobre a janela da PGFN:`, err));
    log.info(`PGFN retry agendado para ${payload.phone} (CNPJ ${payload.cnpj}) em ~${delayMinutes}min + aviso enviado.`);
    return delayMinutes;
}
/** Monta a mensagem do resultado da reconsulta, em linguagem de cliente. */
function buildResultMessage(result) {
    const intro = `🔔 Bom dia! Como combinei, agora que abriu o horário consultei a sua *Dívida Ativa da União (PGFN)*:`;
    if (result.tem_debitos_detectado === true) {
        const r = result.resumo;
        const situacao = r.situacoes.length ? ` (${r.situacoes.join('; ')})` : '';
        return `${intro}\n\n⚠️ Encontrei *${r.total_inscricoes}* inscrição(ões) em dívida ativa, somando *${r.valor_total_consolidado_moeda}*${situacao}.\n\nQuer que eu te explique como regularizar isso?`;
    }
    if (result.tem_debitos_detectado === false) {
        return `${intro}\n\n✅ Sem inscrições em dívida ativa na União. Está tudo certo por aqui!`;
    }
    return `🔔 Bom dia! Tentei reconsultar a sua *Dívida Ativa da União (PGFN)*, mas o sistema da Receita não respondeu agora. Vou tentar de novo e, se persistir, encaminho a um especialista.`;
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