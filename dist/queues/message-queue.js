"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const redis_2 = require("../lib/redis");
const evolution_1 = require("../lib/evolution");
const utils_1 = require("../lib/utils");
const socket_1 = require("../lib/socket");
const logger_1 = require("../lib/logger");
const poker_1 = require("../lib/poker");
// ==================== Filas ====================
/** Fila de envio de mensagens com delay */
exports.messageQueue = new bullmq_1.Queue('message-sending', {
    connection: (0, redis_2.createRedisConnection)(),
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 * 24 }, // Remove após 24h
        removeOnFail: { age: 3600 * 24 * 7 }, // Mantém falhas por 7 dias
    },
});
/** Fila de follow-up (mensagens agendadas) */
exports.followUpQueue = new bullmq_1.Queue('follow-up', {
    connection: (0, redis_2.createRedisConnection)(),
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
        logger_1.queueLogger.info(`${payload.messages.length} mensagens enfileiradas para ${payload.phone} (Job: ${jobId})`);
        return jobId;
    }
    catch (error) {
        logger_1.queueLogger.error('Erro ao enfileirar mensagens:', error);
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
        logger_1.queueLogger.info(`Follow-up agendado para ${phone} em ${delayMs}ms (Job: ${jobId})`);
        return jobId;
    }
    catch (error) {
        logger_1.queueLogger.error('Erro ao agendar follow-up:', error);
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
            logger_1.queueLogger.debug(`Follow-up cancelado: ${job.id} para ${phone}`);
        }
        if (pending.length > 0) {
            logger_1.queueLogger.info(`${pending.length} follow-ups cancelados para ${phone}`);
        }
    }
    catch (error) {
        logger_1.queueLogger.error('Erro ao cancelar follow-ups:', error);
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
        logger_1.workerLogger.info(`Processando ${messages.length} mensagens para ${phone} (Context: ${context})`);
        // Parar o Keep-alive de alta frequência se ele estiver ativo (bot começou a responder)
        (0, poker_1.stopHighFrequencyPoke)();
        const jid = (0, utils_1.toWhatsAppJid)(phone);
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
                    if (msgBotLabel.includes('APOLO (SDR)'))
                        invisiblePrefix = '\u200B'; // 1
                    else if (msgBotLabel.includes('VENDEDOR'))
                        invisiblePrefix = '\u200B\u200B'; // 2
                    else if (msgBotLabel.includes('ATENDENTE'))
                        invisiblePrefix = '\u200B\u200B\u200B'; // 3
                    textToSend = invisiblePrefix + textToSend;
                    if (captionToSend)
                        captionToSend = invisiblePrefix + captionToSend;
                }
                switch (msg.type) {
                    case 'text':
                    case 'link':
                        await (0, evolution_1.evolutionSendTextMessage)(jid, textToSend);
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
                        await (0, evolution_1.evolutionSendMediaMessage)(jid, mediaUrl, mediatype, captionToSend, msg.content.split('/').pop() || 'file', mimetype);
                        break;
                    }
                }
                // Tentar obter o LID associado para notificar a sala correta no frontend
                const associatedLid = await redis_1.default.get(`phone_lid:${phone}`).catch(() => null);
                // Notificar Socket Server sobre mensagem enviada
                (0, socket_1.notifySocketServer)('haylander-chat-updates', {
                    chatId: jid,
                    altChatId: associatedLid || (0, utils_1.toWhatsAppJid)(phone), // Se tiver LID, avisa a sala do LID também
                    fromMe: true,
                    message: { conversation: textToSend },
                    id: `msg-${Date.now()}-${i}`,
                    messageTimestamp: Math.floor(Date.now() / 1000),
                }).catch(() => { });
                // Atualizar progresso do job
                await job.updateProgress((i + 1) / messages.length * 100);
            }
            catch (sendError) {
                logger_1.workerLogger.error(`Erro ao enviar mensagem ${i + 1}/${messages.length} para ${phone}:`, sendError);
                // Propaga o erro para que o BullMQ possa realizar os 'attempts' (retentativas) configurados
                throw sendError;
            }
        }
        logger_1.workerLogger.info(`✅ Todas as ${messages.length} mensagens processadas para ${phone}`);
    }, {
        connection: (0, redis_2.createRedisConnection)(),
        concurrency: 5, // Processa 5 jobs simultaneamente
        limiter: {
            max: 20, // Máximo 20 jobs
            duration: 1000, // por segundo (rate limit)
        },
    });
    worker.on('completed', (job) => {
        logger_1.workerLogger.debug(`Job ${job.id} concluído`);
    });
    worker.on('failed', (job, err) => {
        logger_1.workerLogger.error(`Job ${job?.id} falhou: ${err.message}`);
    });
    return worker;
}
/**
 * Worker que processa follow-ups agendados
 */
function startFollowUpWorker() {
    const worker = new bullmq_1.Worker('follow-up', async (job) => {
        const { phone, message, type } = job.data;
        logger_1.followUpLogger.info(`Processando ${type} para ${phone}`);
        // Parar o Keep-alive de alta frequência se ele estiver ativo (job de follow-up iniciado)
        (0, poker_1.stopHighFrequencyPoke)();
        // Processando mensagem
        const jid = (0, utils_1.toWhatsAppJid)(phone);
        const lastActivity = await redis_1.default.get(`last_activity:${phone}`);
        if (lastActivity) {
            const lastActivityTime = parseInt(lastActivity, 10);
            const timeSinceLastActivity = Date.now() - lastActivityTime;
            // Se o cliente respondeu nos últimos 5 minutos, cancela este follow-up
            if (timeSinceLastActivity < 5 * 60 * 1000 && type === 'nudge') {
                logger_1.followUpLogger.info(`Cliente respondeu recentemente. Cancelando nudge para ${phone}`);
                return;
            }
        }
        await (0, evolution_1.evolutionSendTextMessage)(jid, message);
        // Registrar nudge no histórico para a IA ter o contexto da resposta do usuário
        try {
            const { addToHistory } = await Promise.resolve().then(() => __importStar(require('../lib/chat-history')));
            await addToHistory(phone, 'assistant', message);
        }
        catch (histErr) {
            logger_1.followUpLogger.warn('Erro ao salvar nudge no histórico:', histErr);
        }
        logger_1.followUpLogger.info(`✅ ${type} enviado para ${phone}`);
    }, {
        connection: (0, redis_2.createRedisConnection)(),
        concurrency: 3,
    });
    worker.on('completed', (job) => {
        logger_1.followUpLogger.debug(`Job ${job.id} concluído`);
    });
    worker.on('failed', (job, err) => {
        logger_1.followUpLogger.error(`Job ${job?.id} falhou: ${err.message}`);
    });
    return worker;
}
//# sourceMappingURL=message-queue.js.map