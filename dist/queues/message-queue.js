"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.followUpQueue = exports.messageQueue = void 0;
exports.enqueueMessages = enqueueMessages;
exports.scheduleFollowUp = scheduleFollowUp;
exports.cancelPendingFollowUps = cancelPendingFollowUps;
exports.startMessageWorker = startMessageWorker;
exports.startFollowUpWorker = startFollowUpWorker;
const bullmq_1 = require("bullmq");
const redis_1 = __importDefault(require("../lib/redis"));
const evolution_1 = require("../lib/evolution");
const utils_1 = require("../lib/utils");
const socket_1 = require("../lib/socket");
// ==================== Filas ====================
/** Fila de envio de mensagens com delay */
exports.messageQueue = new bullmq_1.Queue('message-sending', {
    connection: redis_1.default,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 * 24 }, // Remove após 24h
        removeOnFail: { age: 3600 * 24 * 7 }, // Mantém falhas por 7 dias
    },
});
/** Fila de follow-up (mensagens agendadas) */
exports.followUpQueue = new bullmq_1.Queue('follow-up', {
    connection: redis_1.default,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 * 24 },
        removeOnFail: { age: 3600 * 24 * 7 },
    },
});
// ==================== Funções de Enfileiramento ====================
/**
 * Substitui o sendToN8nHandler — enfileira mensagens para envio sequencial com delay
 */
async function enqueueMessages(payload) {
    try {
        const jobId = `msg-${payload.phone}-${Date.now()}`;
        await exports.messageQueue.add('send-messages', payload, { jobId });
        console.log(`[Queue] ${payload.messages.length} mensagens enfileiradas para ${payload.phone} (Job: ${jobId})`);
        return jobId;
    }
    catch (error) {
        console.error('[Queue] Erro ao enfileirar mensagens:', error);
        throw error;
    }
}
/**
 * Agenda um follow-up (ex: lembrete de procuração, nudge de inatividade)
 */
async function scheduleFollowUp(phone, message, delayMs, type = 'follow_up', metadata) {
    try {
        const jobId = `followup-${phone}-${type}-${Date.now()}`;
        await exports.followUpQueue.add('send-follow-up', { phone, message, type, metadata }, {
            jobId,
            delay: delayMs,
        });
        console.log(`[Queue] Follow-up agendado para ${phone} em ${delayMs}ms (Job: ${jobId})`);
        return jobId;
    }
    catch (error) {
        console.error('[Queue] Erro ao agendar follow-up:', error);
        throw error;
    }
}
/**
 * Cancela follow-ups pendentes de um telefone (quando o cliente responde)
 */
async function cancelPendingFollowUps(phone) {
    try {
        const delayed = await exports.followUpQueue.getDelayed();
        const pending = delayed.filter(job => {
            const data = job.data;
            return data.phone === phone;
        });
        for (const job of pending) {
            await job.remove();
            console.log(`[Queue] Follow-up cancelado: ${job.id} para ${phone}`);
        }
        if (pending.length > 0) {
            console.log(`[Queue] ${pending.length} follow-ups cancelados para ${phone}`);
        }
    }
    catch (error) {
        console.error('[Queue] Erro ao cancelar follow-ups:', error);
    }
}
// ==================== Workers ====================
/**
 * Worker que processa envio de mensagens sequenciais com delay
 * Substitui COMPLETAMENTE o n8n para envio de mensagens
 */
function startMessageWorker() {
    const worker = new bullmq_1.Worker('message-sending', async (job) => {
        const { phone, messages, context } = job.data;
        console.log(`[Worker] Processando ${messages.length} mensagens para ${phone} (Context: ${context})`);
        const jid = (0, utils_1.toWhatsAppJid)(phone);
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            // Delay entre mensagens (simula digitação)
            if (msg.delay && msg.delay > 0 && i > 0) {
                await new Promise(resolve => setTimeout(resolve, msg.delay));
            }
            try {
                switch (msg.type) {
                    case 'text':
                    case 'link':
                        await (0, evolution_1.evolutionSendTextMessage)(jid, msg.content);
                        break;
                    case 'media': {
                        const mediaUrl = msg.content;
                        const ext = mediaUrl.split('.').pop()?.toLowerCase();
                        let mediatype = 'document';
                        let mimetype = 'application/octet-stream';
                        if (['mp4', 'mov'].includes(ext || '')) {
                            mediatype = 'video';
                            mimetype = 'video/mp4';
                        }
                        else if (['jpg', 'jpeg', 'png'].includes(ext || '')) {
                            mediatype = 'image';
                            mimetype = 'image/jpeg';
                        }
                        else if (['mp3', 'ogg'].includes(ext || '')) {
                            mediatype = 'audio';
                            mimetype = 'audio/mpeg';
                        }
                        else if (ext === 'pdf') {
                            mediatype = 'document';
                            mimetype = 'application/pdf';
                        }
                        await (0, evolution_1.evolutionSendMediaMessage)(jid, mediaUrl, mediatype, msg.content.split('/').pop() || 'file', 'file', mimetype);
                        break;
                    }
                }
                // Notificar Socket Server sobre mensagem enviada
                (0, socket_1.notifySocketServer)('chat-updates', {
                    chatId: jid,
                    fromMe: true,
                    message: { conversation: msg.content },
                    messageTimestamp: Math.floor(Date.now() / 1000),
                }).catch(() => { });
                // Atualizar progresso do job
                await job.updateProgress((i + 1) / messages.length * 100);
            }
            catch (sendError) {
                console.error(`[Worker] Erro ao enviar mensagem ${i + 1}/${messages.length} para ${phone}:`, sendError);
                // Continua tentando as próximas mensagens
            }
        }
        console.log(`[Worker] ✅ Todas as ${messages.length} mensagens enviadas para ${phone}`);
    }, {
        connection: redis_1.default,
        concurrency: 5, // Processa 5 jobs simultaneamente
        limiter: {
            max: 20, // Máximo 20 jobs
            duration: 1000, // por segundo (rate limit)
        },
    });
    worker.on('completed', (job) => {
        console.log(`[Worker] Job ${job.id} concluído`);
    });
    worker.on('failed', (job, err) => {
        console.error(`[Worker] Job ${job?.id} falhou:`, err.message);
    });
    return worker;
}
/**
 * Worker que processa follow-ups agendados
 */
function startFollowUpWorker() {
    const worker = new bullmq_1.Worker('follow-up', async (job) => {
        const { phone, message, type } = job.data;
        console.log(`[FollowUp] Enviando ${type} para ${phone}`);
        // Verificar se o cliente respondeu recentemente (evitar follow-up indesejado)
        const jid = (0, utils_1.toWhatsAppJid)(phone);
        const lastActivity = await redis_1.default.get(`last_activity:${phone}`);
        if (lastActivity) {
            const lastActivityTime = parseInt(lastActivity, 10);
            const timeSinceLastActivity = Date.now() - lastActivityTime;
            // Se o cliente respondeu nos últimos 5 minutos, cancela este follow-up
            if (timeSinceLastActivity < 5 * 60 * 1000 && type === 'nudge') {
                console.log(`[FollowUp] Cliente respondeu recentemente. Cancelando nudge para ${phone}`);
                return;
            }
        }
        await (0, evolution_1.evolutionSendTextMessage)(jid, message);
        console.log(`[FollowUp] ✅ ${type} enviado para ${phone}`);
    }, {
        connection: redis_1.default,
        concurrency: 3,
    });
    worker.on('completed', (job) => {
        console.log(`[FollowUp] Job ${job.id} concluído`);
    });
    worker.on('failed', (job, err) => {
        console.error(`[FollowUp] Job ${job?.id} falhou:`, err.message);
    });
    return worker;
}
//# sourceMappingURL=message-queue.js.map