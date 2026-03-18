import { Queue, Worker, Job } from 'bullmq';
import redis from '../lib/redis';
import { createRedisConnection } from '../lib/redis';
import { evolutionSendTextMessage, evolutionSendMediaMessage } from '../lib/evolution';
import { toWhatsAppJid } from '../lib/utils';
import { notifySocketServer } from '../lib/socket';
import { queueLogger, workerLogger, followUpLogger } from '../lib/logger';
import { isWithinBusinessHours } from '../lib/business-hours';

// ==================== Filas ====================

/** Fila de envio de mensagens com delay */
export const messageQueue = new Queue('message-sending', {
    connection: createRedisConnection() as any,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 * 24 }, // Remove após 24h
        removeOnFail: { age: 3600 * 24 * 7 }, // Mantém falhas por 7 dias
    },
});

/** Fila de follow-up (mensagens agendadas) */
export const followUpQueue = new Queue('follow-up', {
    connection: createRedisConnection() as any,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 * 24 },
        removeOnFail: { age: 3600 * 24 * 7 },
    },
});

// ==================== Interfaces ====================

export interface MessageJobData {
    phone: string;
    messages: Array<{
        content: string;
        type: 'text' | 'media' | 'link';
        delay?: number;
        options?: Record<string, unknown>;
    }>;
    context?: string;
    leadId?: number;
}

export interface FollowUpJobData {
    phone: string;
    message: string;
    type: 'nudge' | 'follow_up' | 'reminder';
    metadata?: Record<string, unknown>;
}

// ==================== Funções de Enfileiramento ====================

/**
 * Substitui o sendToN8nHandler — enfileira mensagens para envio sequencial com delay
 */
export async function enqueueMessages(payload: MessageJobData): Promise<string> {
    try {
        const jobId = `msg-${payload.phone}-${Date.now()}`;
        await messageQueue.add('send-messages', payload, { jobId });
        queueLogger.info(`${payload.messages.length} mensagens enfileiradas para ${payload.phone} (Job: ${jobId})`);
        return jobId;
    } catch (error) {
        queueLogger.error('Erro ao enfileirar mensagens:', error);
        throw error;
    }
}

/**
 * Agenda um follow-up (ex: lembrete de procuração, nudge de inatividade)
 */
export async function scheduleFollowUp(
    phone: string,
    message: string,
    delayMs: number,
    type: FollowUpJobData['type'] = 'follow_up',
    metadata?: Record<string, unknown>
): Promise<string> {
    try {
        const jobId = `followup-${phone}-${type}-${Date.now()}`;
        await followUpQueue.add('send-follow-up', { phone, message, type, metadata }, {
            jobId,
            delay: delayMs,
        });
        queueLogger.info(`Follow-up agendado para ${phone} em ${delayMs}ms (Job: ${jobId})`);
        return jobId;
    } catch (error) {
        queueLogger.error('Erro ao agendar follow-up:', error);
        throw error;
    }
}

/**
 * Cancela follow-ups pendentes de um telefone (quando o cliente responde)
 */
export async function cancelPendingFollowUps(phone: string): Promise<void> {
    try {
        const delayed = await followUpQueue.getDelayed();
        const pending = delayed.filter(job => {
            const data = job.data as FollowUpJobData;
            return data.phone === phone;
        });

        for (const job of pending) {
            await job.remove();
            queueLogger.debug(`Follow-up cancelado: ${job.id} para ${phone}`);
        }

        if (pending.length > 0) {
            queueLogger.info(`${pending.length} follow-ups cancelados para ${phone}`);
        }
    } catch (error) {
        queueLogger.error('Erro ao cancelar follow-ups:', error);
    }
}

// ==================== Workers ====================

/**
 * Worker que processa envio de mensagens sequenciais com delay
 * Substitui COMPLETAMENTE o n8n para envio de mensagens
 */
export function startMessageWorker(): Worker {
    const worker = new Worker<MessageJobData>('message-sending', async (job: Job<MessageJobData>) => {
        const { phone, messages, context } = job.data;
        workerLogger.info(`Processando ${messages.length} mensagens para ${phone} (Context: ${context})`);

        const jid = toWhatsAppJid(phone);

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            // Delay entre mensagens (simula digitação)
            if (msg.delay && msg.delay > 0 && i > 0) {
                await new Promise(resolve => setTimeout(resolve, msg.delay));
            }

            try {
                let textToSend = msg.content;
                let captionToSend = msg.content;
                let msgBotLabel = '';
                
                if (context && context.startsWith('agent-response|')) {
                    msgBotLabel = context.split('|')[1];
                    let invisiblePrefix = '\u200B\u200B\u200B\u200B'; // Padrao: 4
                    if (msgBotLabel.includes('APOLO (SDR)')) invisiblePrefix = '\u200B'; // 1
                    else if (msgBotLabel.includes('VENDEDOR')) invisiblePrefix = '\u200B\u200B'; // 2
                    else if (msgBotLabel.includes('ATENDENTE')) invisiblePrefix = '\u200B\u200B\u200B'; // 3
                    
                    textToSend = invisiblePrefix + textToSend;
                    if (captionToSend) captionToSend = invisiblePrefix + captionToSend;
                }

                switch (msg.type) {
                    case 'text':
                    case 'link':
                        await evolutionSendTextMessage(jid, textToSend);
                        break;
                    case 'media': {
                        const mediaUrl = msg.content;
                        const ext = mediaUrl.split('.').pop()?.toLowerCase();
                        let mediatype: 'image' | 'video' | 'audio' | 'document' = 'document';
                        let mimetype = 'application/octet-stream';

                        if (['mp4', 'mov'].includes(ext || '')) { mediatype = 'video'; mimetype = 'video/mp4'; }
                        else if (['jpg', 'jpeg', 'png'].includes(ext || '')) { mediatype = 'image'; mimetype = 'image/jpeg'; }
                        else if (['mp3', 'ogg'].includes(ext || '')) { mediatype = 'audio'; mimetype = 'audio/mpeg'; }
                        else if (ext === 'pdf') { mediatype = 'document'; mimetype = 'application/pdf'; }

                        await evolutionSendMediaMessage(jid, mediaUrl, mediatype, captionToSend, msg.content.split('/').pop() || 'file', mimetype);
                        break;
                    }
                }

                // Tentar obter o LID associado para notificar a sala correta no frontend
                const associatedLid = await redis.get(`phone_lid:${phone}`).catch(() => null);

                // Notificar Socket Server sobre mensagem enviada
                notifySocketServer('haylander-chat-updates', {
                    chatId: jid,
                    altChatId: associatedLid || toWhatsAppJid(phone), // Se tiver LID, avisa a sala do LID também
                    fromMe: true,
                    message: { conversation: textToSend },
                    messageTimestamp: Math.floor(Date.now() / 1000),
                }).catch(() => { /* silencioso */ });

                // Atualizar progresso do job
                await job.updateProgress((i + 1) / messages.length * 100);
            } catch (sendError) {
                workerLogger.error(`Erro ao enviar mensagem ${i + 1}/${messages.length} para ${phone}:`, sendError);
                // Propaga o erro para que o BullMQ possa realizar os 'attempts' (retentativas) configurados
                throw sendError;
            }
        }

        workerLogger.info(`✅ Todas as ${messages.length} mensagens processadas para ${phone}`);
    }, {
        connection: createRedisConnection() as any,
        concurrency: 5, // Processa 5 jobs simultaneamente
        limiter: {
            max: 20,     // Máximo 20 jobs
            duration: 1000, // por segundo (rate limit)
        },
    });

    worker.on('completed', (job) => {
        workerLogger.debug(`Job ${job.id} concluído`);
    });

    worker.on('failed', (job, err) => {
        workerLogger.error(`Job ${job?.id} falhou: ${err.message}`);
    });

    return worker;
}

/**
 * Worker que processa follow-ups agendados
 */
export function startFollowUpWorker(): Worker {
    const worker = new Worker<FollowUpJobData>('follow-up', async (job: Job<FollowUpJobData>) => {
        const { phone, message, type } = job.data;
        followUpLogger.info(`Processando ${type} para ${phone}`);

        // Processando mensagem
        const jid = toWhatsAppJid(phone);
        const lastActivity = await redis.get(`last_activity:${phone}`);

        if (lastActivity) {
            const lastActivityTime = parseInt(lastActivity, 10);
            const timeSinceLastActivity = Date.now() - lastActivityTime;

            // Se o cliente respondeu nos últimos 5 minutos, cancela este follow-up
            if (timeSinceLastActivity < 5 * 60 * 1000 && type === 'nudge') {
                followUpLogger.info(`Cliente respondeu recentemente. Cancelando nudge para ${phone}`);
                return;
            }
        }

        await evolutionSendTextMessage(jid, message);
        
        // Registrar nudge no histórico para a IA ter o contexto da resposta do usuário
        try {
            const { addToHistory } = await import('../lib/chat-history');
            await addToHistory(phone, 'assistant', message);
        } catch (histErr) {
            followUpLogger.warn('Erro ao salvar nudge no histórico:', histErr);
        }

        followUpLogger.info(`✅ ${type} enviado para ${phone}`);
    }, {
        connection: createRedisConnection() as any,
        concurrency: 3,
    });

    worker.on('completed', (job) => {
        followUpLogger.debug(`Job ${job.id} concluído`);
    });

    worker.on('failed', (job, err) => {
        followUpLogger.error(`Job ${job?.id} falhou: ${err.message}`);
    });

    return worker;
}
