import { Queue, Worker, Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis';
import { enqueueMessages, scheduleFollowUp } from './message-queue';
import {
    consultarDividaAtivaPorDevedor,
    isPgfnWindowOpen,
    minutesUntilPgfnOpen,
    nextPgfnWindowDescription,
    PGFN_WINDOW,
} from '../lib/pgfn';
import { cronLogger } from '../lib/logger';
import { saveConsultation } from '../lib/serpro-db';
import pool from '../lib/db';

const QUEUE_NAME = 'pgfn-window-retry';
const log = cronLogger;

// Pequena folga para o aviso chegar logo DEPOIS da resposta do Apolo (que é enfileirada na hora),
// lendo como um follow-up natural em vez de competir com a mensagem do resultado do PGMEI.
const NOTICE_DELAY_MS = 8_000;

/** Aviso determinístico ao cliente de que a Dívida Ativa será consultada na próxima janela. */
function buildWindowNoticeMessage(): string {
    const quando = nextPgfnWindowDescription();
    return (
        `📌 Só um detalhe sobre a *Dívida Ativa da União (PGFN)*: essa consulta só fica disponível ` +
        `em horário comercial (das ${PGFN_WINDOW.openLabel} às ${PGFN_WINDOW.closeLabel}). ` +
        `Já deixei agendado e vou fazer a verificação automaticamente ${quando} — ` +
        `assim que tiver o resultado, te trago aqui com o valor exato. 👍`
    );
}

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
    const jobId = `pgfn-retry-${payload.phone}`;
    const delayMinutes = minutesUntilPgfnOpen() + 5;

    // Se já existe retry agendado para este telefone (ex.: PGMEI e Dívida Ativa consultadas no mesmo
    // atendimento), não reagenda nem reavisa — o cliente já foi informado uma vez.
    const existing = await pgfnRetryQueue.getJob(jobId);
    if (existing) {
        log.info(`PGFN retry já agendado para ${payload.phone}; não reagenda nem reavisa.`);
        return delayMinutes;
    }

    await pgfnRetryQueue.add('retry', payload, { jobId, delay: delayMinutes * 60_000 });

    // Avisa o cliente DE FORMA DETERMINÍSTICA (não depende do LLM) que a Dívida Ativa será
    // consultada na próxima janela e o resultado virá por aqui — com o valor devido exato.
    await scheduleFollowUp(payload.phone, buildWindowNoticeMessage(), NOTICE_DELAY_MS, 'reminder', {
        kind: 'pgfn-window-confirm',
        cnpj: payload.cnpj,
    }).catch(err => log.error(`Falha ao avisar ${payload.phone} sobre a janela da PGFN:`, err));

    log.info(`PGFN retry agendado para ${payload.phone} (CNPJ ${payload.cnpj}) em ~${delayMinutes}min + aviso enviado.`);
    return delayMinutes;
}

/** Monta a mensagem do resultado da reconsulta, em linguagem de cliente. */
function buildResultMessage(result: Awaited<ReturnType<typeof consultarDividaAtivaPorDevedor>>): string {
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

            // Registra na auditoria (source 'loop') para a consulta da janela aparecer no
            // histórico/Resumo da empresa — antes este caminho consultava sem persistir nada.
            await saveConsultation(cnpj, 'PGFN_API', result, 200, 'loop').catch(() => {});

            // Persiste o valor real da dívida (ficou desconhecido quando a chamada original
            // ocorreu fora do horário). Atualiza nos dois lugares:
            //   1. integra_empresas — valor por empresa (fonte canônica do painel)
            //   2. leads            — valor do lead (usado pelo bot no contexto do atendimento)
            if (result.tem_debitos_detectado === true && (result.resumo?.valor_total_consolidado ?? 0) > 0) {
                const valor = result.resumo!.valor_total_consolidado;
                const cnpjDigits = cnpj.replace(/\D/g, '');
                const phoneDigits = phone.replace(/\D/g, '');

                await Promise.all([
                    pool.query(
                        `UPDATE integra_empresas SET valor_divida_pgfn = $1
                         WHERE REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') = $2`,
                        [valor, cnpjDigits]
                    ),
                    pool.query(
                        `UPDATE leads SET valor_divida_pgfn = $1
                         WHERE REGEXP_REPLACE(telefone, '[^0-9]', '', 'g') = $2`,
                        [valor, phoneDigits]
                    ),
                ]).catch(err => log.error(`PGFN retry: erro ao persistir valor_divida_pgfn (CNPJ ${cnpj}, phone ${phone}):`, err));

                log.info(`PGFN: valor_divida_pgfn=${valor} salvo para CNPJ ${cnpj} (${phone}).`);
            }

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
