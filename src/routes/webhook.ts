import { Router, Request, Response } from 'express';
import { addToHistory } from '../lib/chat-history';
import redis from '../lib/redis';
import { notifySocketServer } from '../lib/socket';
import { cancelPendingFollowUps } from '../queues/message-queue';
import { bufferAndDebounce } from '../queues/message-debounce';
import { parseIncomingMessage } from '../lib/message-parser';
import { webhookLogger } from '../lib/logger';
import { saveLidPhoneMapping } from '../lib/lid-map';

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

        if (body.event !== 'messages.upsert') {
            log.debug(`Ignorando evento: ${body.event}`);
            res.json({ status: 'ignored_event_type' });
            return;
        }

        // Extrai a mensagem do payload usando o parser dedicado
        const msgData = body.data?.message;
        const base64FromBody = body.data?.base64;
        const messageId = body.data?.key?.id as string | undefined;
        const message = await parseIncomingMessage(msgData, base64FromBody, messageId);

        // Identify the user phone — priorizar número real, aceitar LID como fallback
        // ATENÇÃO: body.sender é o número da INSTÂNCIA, NÃO do usuário!
        const candidatos = [
            body.data?.key?.senderPn,        // Evolution API v2: número real quando remoteJid é LID
            body.senderpn,
            body.data?.senderpn,
            body.senderPhone,
            body.data?.senderPhone,
            body.data?.key?.participant,
            body.data?.participant,
            body.data?.key?.remoteJid,       // Último recurso — pode ser LID
        ].filter(Boolean);

        // Pegar o primeiro que NÃO seja grupo, preferindo não-LID
        let sender = candidatos.find(s => !s.includes('@lid') && !s.includes('@g.us'));

        // Se não achou número real, aceitar LID como fallback (funciona com a Evolution API)
        if (!sender) {
            sender = candidatos.find(s => !s.includes('@g.us'));
            if (sender?.includes('@lid')) {
                log.warn(`⚠️ Usando LID como sender (número real não disponível): ${sender}`);
            }
        }

        const fromMe = body.data?.key?.fromMe;
        const pushName = body.data?.pushName;

        if (fromMe) {
            res.json({ status: 'ignored_from_me' });
            return;
        }

        if (!message || !sender) {
            res.json({ status: 'ignored_invalid' });
            return;
        }

        const userPhone = sender.replace('@s.whatsapp.net', '').replace('@lid', '');
        const logMsg = typeof message === 'string' ? message : '[Conteúdo Multimodal/Imagem]';
        log.info(`📩 Mensagem de ${userPhone}: ${logMsg}`);

        // Salvar mapeamento LID → telefone real (Redis + PostgreSQL)
        const remoteJid = body.data?.key?.remoteJid;
        if (remoteJid?.includes('@lid') && userPhone && !userPhone.includes('@lid')) {
            saveLidPhoneMapping(remoteJid, userPhone, pushName).catch(err =>
                log.error('Erro ao salvar mapeamento LID:', err)
            );
            log.debug(`🗺️ Mapeamento LID salvo: ${remoteJid} → ${userPhone}`);
        }

        // 0. Cancelar follow-ups pendentes (cliente respondeu)
        cancelPendingFollowUps(userPhone).catch(err =>
            log.error('Erro ao cancelar follow-ups:', err)
        );

        // Registrar atividade no Redis
        redis.set(`last_activity:${userPhone}`, Date.now().toString(), 'EX', 86400).catch(() => { });

        // 1. Registrar atividade no Redis (para nudges)
        redis.set(`last_activity:${userPhone}`, Date.now().toString(), 'EX', 86400).catch(() => { });

        // 2. Publish INCOMING message to Redis for Real-time
        const incomingSocketMsg = { chatId: sender, senderPn: sender, userPhone, ...body.data };
        notifySocketServer('haylander-bot-events', incomingSocketMsg).catch(err =>
            log.error('Socket notification failed:', err)
        );



        // 2. DEBOUNCE: acumular mensagem e agendar processamento
        const messageText = typeof message === 'string' ? message : JSON.stringify(message);
        await bufferAndDebounce(userPhone, messageText, {
            sender,
            pushName,
            userPhone,
        });

        totalTimer.end();
        res.json({ status: 'buffered' });
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
    } catch (err) {
        res.status(500).json({ error: 'Failed to process notification' });
    }
});

export default router;
