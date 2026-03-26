"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const logger_1 = require("../lib/logger");
const message_processor_1 = require("../lib/message-processor");
const redis_1 = __importDefault(require("../lib/redis"));
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
        // Registrar atividade global da instância no Redis ao receber qualquer evento do Webhook
        redis_1.default.set('evolution:last_activity', Date.now().toString()).catch(() => { });
        const eventNormalized = body.event?.toLowerCase();
        if (eventNormalized !== 'messages.upsert') {
            log.debug(`Ignorando evento desinteressante: ${body.event}`);
            res.json({ status: 'ignored_event_type', event: body.event });
            return;
        }
        // Delegar ao processador centralizado
        const result = await (0, message_processor_1.processIncomingMessage)({
            event: body.event,
            instance: body.instance,
            data: body.data
        });
        totalTimer.end();
        res.json(result);
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