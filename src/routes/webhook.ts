import { Router, Request, Response } from 'express';
import { webhookLogger } from '../lib/logger';
import { processIncomingMessage } from '../lib/message-processor';
import redis from '../lib/redis';
import { getIO } from '../lib/socket-server';

let requestCounter = 0;
function nextTraceId(): string {
    return `wh-${(++requestCounter).toString(36)}-${Date.now().toString(36)}`;
}

const router = Router();

router.get('/webhook/whatsapp', (_req: Request, res: Response) => {
    res.json({
        status: 'online',
        message: 'Bot Backend Webhook is active and ready to receive POST requests',
        timestamp: new Date().toISOString(),
    });
});

router.post('/webhook/whatsapp', async (req: Request, res: Response) => {
    console.log('\n**************************************************');
    console.log(`[${new Date().toISOString()}] 📥 WEBHOOK RECEBIDO!`);
    console.log(`Headers: ${JSON.stringify(req.headers)}`);
    console.log('**************************************************\n');
    const traceId = nextTraceId();
    const log = webhookLogger.withTrace(traceId);
    const totalTimer = log.timer('Webhook total');

    try {
        const apiKeyHeader = req.headers['apikey'] as string || (req.headers['authorization'] as string)?.replace('Bearer ', '');
        if (process.env.EVOLUTION_API_KEY && apiKeyHeader !== process.env.EVOLUTION_API_KEY) {
            log.warn('🚫 Tentativa de acesso não autorizado');
            res.status(401).json({ status: 'unauthorized', error: 'Invalid API Key' });
            return;
        }

        const body = req.body;
        log.debug('Body recebido:', body);

        // Registrar atividade global da instância no Redis ao receber qualquer evento do Webhook
        redis.set('evolution:last_activity', Date.now().toString()).catch(() => {});

        const eventNormalized = (body.event as string)?.toLowerCase();
        if (eventNormalized !== 'messages.upsert') {
            log.debug(`Ignorando evento desinteressante: ${body.event}`);
            res.json({ status: 'ignored_event_type', event: body.event });
            return;
        }

        // Delegar ao processador centralizado
        const result = await processIncomingMessage({
            event: body.event,
            instance: body.instance,
            data: body.data
        });

        totalTimer.end();
        res.json(result);
    } catch (error: unknown) {
        log.error('❌ Erro no Webhook:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            details: error instanceof Error ? error.message : String(error),
        });
    }
});

// Health check
router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// HTTP Fallback for Socket.io
router.post('/notify', (req: Request, res: Response) => {
    try {
        const { channel, data } = req.body;
        if (!channel || !data) {
            res.status(400).json({ error: 'Missing channel or data' });
            return;
        }

        const io = getIO();
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
    } catch (err) {
        res.status(500).json({ error: 'Failed to process notification' });
    }
});

export default router;
