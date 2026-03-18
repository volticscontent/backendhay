"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const chat_history_1 = require("../lib/chat-history");
const redis_1 = __importDefault(require("../lib/redis"));
const socket_1 = require("../lib/socket");
const message_queue_1 = require("../queues/message-queue");
const message_debounce_1 = require("../queues/message-debounce");
const message_parser_1 = require("../lib/message-parser");
const logger_1 = require("../lib/logger");
const lid_map_1 = require("../lib/lid-map");
let requestCounter = 0;
function nextTraceId() {
    return `wh-${(++requestCounter).toString(36)}-${Date.now().toString(36)}`;
}
const router = (0, express_1.Router)();
router.get('/webhook/whatsapp', (_req, res) => {
    res.json({
        status: 'online',
        message: 'Bot Backend Webhook is active and ready to receive POST requests',
        timestamp: new Date().toISOString(),
    });
});
router.post('/webhook/whatsapp', async (req, res) => {
    console.log('\n**************************************************');
    console.log(`[${new Date().toISOString()}] 📥 WEBHOOK RECEBIDO!`);
    console.log(`Headers: ${JSON.stringify(req.headers)}`);
    console.log('**************************************************\n');
    const traceId = nextTraceId();
    const log = logger_1.webhookLogger.withTrace(traceId);
    const totalTimer = log.timer('Webhook total');
    try {
        const apiKeyHeader = req.headers['apikey'] || req.headers['authorization']?.replace('Bearer ', '');
        if (process.env.EVOLUTION_API_KEY && apiKeyHeader !== process.env.EVOLUTION_API_KEY) {
            log.warn('🚫 Tentativa de acesso não autorizado');
            res.status(401).json({ status: 'unauthorized', error: 'Invalid API Key' });
            return;
        }
        const body = req.body;
        log.debug('Body recebido:', body);
        if (body.event !== 'messages.upsert') {
            log.debug(`Ignorando evento desinteressante: ${body.event}`);
            res.json({ status: 'ignored_event_type', event: body.event });
            return;
        }
        // Extrai a mensagem do payload usando o parser dedicado
        const msgData = body.data?.message;
        const base64FromBody = body.data?.base64;
        const messageId = body.data?.key?.id;
        const message = await (0, message_parser_1.parseIncomingMessage)(msgData, base64FromBody, messageId);
        // Identify the user phone — priorizar número real, aceitar LID como fallback
        const remoteJid = body.data?.key?.remoteJid;
        const senderPn = body.data?.key?.senderPn;
        const candidatos = [
            senderPn, // Evolution API v2: número real quando remoteJid é LID
            body.senderpn,
            body.data?.senderpn,
            body.senderPhone,
            body.data?.senderPhone,
            body.data?.key?.participant,
            body.data?.participant,
            remoteJid, // Último recurso — pode ser LID
        ].filter(Boolean);
        // Pegar o primeiro que NÃO seja grupo, preferindo não-LID
        let sender = candidatos.find(s => !s.includes('@lid') && !s.includes('@g.us'));
        // Se não achou número real, aceitar LID como fallback
        if (!sender) {
            sender = candidatos.find(s => !s.includes('@g.us'));
        }
        // O chatId para o socket DEVE ser o remoteJid (sala que o frontend assina)
        const chatId = remoteJid || sender;
        const fromMe = body.data?.key?.fromMe;
        const pushName = body.data?.pushName;
        if (fromMe) {
            log.debug('Ignorando mensagem enviada por mim (fromMe: true)');
            res.json({ status: 'ignored_from_me' });
            return;
        }
        if (!message || !sender) {
            log.warn(`Mensagem ou Sender inválido. Message: ${!!message}, Sender: ${sender}`);
            res.json({ status: 'ignored_invalid' });
            return;
        }
        const userPhone = sender.split('@')[0].replace(/\D/g, '');
        const logMsg = typeof message === 'string' ? message : '[Conteúdo Multimodal/Imagem]';
        log.info(`📩 Mensagem de ${userPhone} (${chatId}): ${logMsg}`);
        // Salvar mapeamento LID → telefone real (Redis + PostgreSQL)
        if (remoteJid?.includes('@lid') && userPhone && !sender.includes('@lid')) {
            (0, lid_map_1.saveLidPhoneMapping)(remoteJid, userPhone, pushName).catch(err => log.error('Erro ao salvar mapeamento LID:', err));
            log.debug(`🗺️ Mapeamento LID salvo: ${remoteJid} → ${userPhone}`);
        }
        // 0. Cancelar follow-ups pendentes (cliente respondeu)
        (0, message_queue_1.cancelPendingFollowUps)(userPhone).catch(err => log.error('Erro ao cancelar follow-ups:', err));
        // Registrar atividade no Redis
        redis_1.default.set(`last_activity:${userPhone}`, Date.now().toString(), 'EX', 86400).catch(() => { });
        // 1. Salvar mensagem do usuário no histórico IMEDIATAMENTE (para a AI ver)
        await (0, chat_history_1.addToHistory)(userPhone, 'user', message);
        // 1. Registrar atividade no Redis (para nudges)
        redis_1.default.set(`last_activity:${userPhone}`, Date.now().toString(), 'EX', 86400).catch(() => { });
        // 2. Publish INCOMING message to Redis for Real-time using remoteJid as chatId
        const incomingSocketMsg = {
            chatId, // LID ou Phone (room principal)
            altChatId: sender, // Phone (room secundária)
            senderPn: sender,
            userPhone,
            pushName,
            ...body.data
        };
        (0, socket_1.notifySocketServer)('haylander-bot-events', incomingSocketMsg).catch(err => log.error('Socket notification failed:', err));
        // 2. DEBOUNCE: acumular mensagem e agendar processamento
        const messageText = typeof message === 'string' ? message : JSON.stringify(message);
        await (0, message_debounce_1.bufferAndDebounce)(userPhone, messageText, {
            sender, // Usar o sender (Número Real) para que o bot responda para a pessoa certa
            pushName,
            userPhone,
        });
        totalTimer.end();
        res.json({ status: 'buffered' });
    }
    catch (error) {
        log.error('❌ Erro no Webhook:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            details: error instanceof Error ? error.message : String(error),
        });
    }
});
// Health check
router.get('/health', (_req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
// HTTP Fallback for Socket.io
router.post('/notify', (req, res) => {
    try {
        const { channel, data } = req.body;
        if (!channel || !data) {
            res.status(400).json({ error: 'Missing channel or data' });
            return;
        }
        const io = require('../lib/socket-server').getIO();
        if (!io) {
            res.status(503).json({ error: 'Socket.io not initialized' });
            return;
        }
        if (channel === 'haylander-bot-events' || channel === 'haylander-chat-updates') {
            const chatId = data.chatId;
            if (chatId) {
                io.to(`chat:${chatId}`).emit('new-message', data);
            }
            io.emit('chat-update-global', data);
        }
        res.json({ status: 'notified' });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to process notification' });
    }
});
exports.default = router;
//# sourceMappingURL=webhook.js.map