import { Router, Request, Response } from 'express';
import { addToHistory } from '../lib/chat-history';
import redis from '../lib/redis';
import { notifySocketServer } from '../lib/socket';
import { cancelPendingFollowUps } from '../queues/message-queue';
import { bufferAndDebounce } from '../queues/message-debounce';
import { parseIncomingMessage } from '../lib/message-parser';

const router = Router();

router.get('/webhook/whatsapp', (_req: Request, res: Response) => {
    res.json({
        status: 'online',
        message: 'Bot Backend Webhook is active and ready to receive POST requests',
        timestamp: new Date().toISOString(),
    });
});

router.post('/webhook/whatsapp', async (req: Request, res: Response) => {
    try {
        const apiKeyHeader = req.headers['apikey'] as string || (req.headers['authorization'] as string)?.replace('Bearer ', '');
        if (process.env.EVOLUTION_API_KEY && apiKeyHeader !== process.env.EVOLUTION_API_KEY) {
            console.warn('[Webhook] Unauthorized access attempt.');
            res.status(401).json({ status: 'unauthorized', error: 'Invalid API Key' });
            return;
        }

        const body = req.body;
        console.log('[Webhook] Body recebido:', JSON.stringify(body, null, 2));

        if (body.event !== 'messages.upsert') {
            console.log(`[Webhook] Ignorando evento não-mensagem: ${body.event}`);
            res.json({ status: 'ignored_event_type' });
            return;
        }

        // Extrai a mensagem do payload usando o parser dedicado
        const msgData = body.data?.message;
        const base64FromBody = body.data?.base64;
        const message = await parseIncomingMessage(msgData, base64FromBody);

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
                console.log('[Webhook] ⚠️ Usando LID como sender (número real não disponível):', sender);
                console.log('[Webhook] Body keys:', JSON.stringify(Object.keys(body)));
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

        const userPhone = sender.replace('@s.whatsapp.net', '');
        const logMsg = typeof message === 'string' ? message : '[Conteúdo Multimodal/Imagem]';
        console.log(`[Webhook] Mensagem de ${userPhone}: ${logMsg}`);

        // 0. Cancelar follow-ups pendentes (cliente respondeu)
        cancelPendingFollowUps(userPhone).catch(err =>
            console.error('[Webhook] Failed to cancel follow-ups:', err)
        );

        // Registrar atividade no Redis
        redis.set(`last_activity:${userPhone}`, Date.now().toString(), 'EX', 86400).catch(() => { });

        // 1. Salvar mensagem do usuário no histórico
        await addToHistory(userPhone, 'user', message);

        // 2. Publish INCOMING message to Redis for Real-time
        const incomingSocketMsg = { chatId: sender, ...body.data };
        notifySocketServer('chat-updates', incomingSocketMsg).catch(err =>
            console.error('[Webhook] Socket notification failed:', err)
        );

        // 3. Adicionar à fila de sincronização de contexto
        redis.zadd('context_sync_queue', Date.now(), userPhone).catch(err =>
            console.error('[Webhook] Erro ao adicionar à fila de contexto:', err)
        );
        redis.del(`context_nudge_sent:${userPhone}`).catch(() => { });

        // 4. DEBOUNCE: acumular mensagem e agendar processamento
        //    Se mais mensagens chegarem em 2s, o timer é resetado.
        //    Só processa quando o usuário parar de digitar.
        const messageText = typeof message === 'string' ? message : JSON.stringify(message);
        await bufferAndDebounce(userPhone, messageText, {
            sender,
            pushName,
            userPhone,
        });

        res.json({ status: 'buffered' });
    } catch (error: unknown) {
        console.error('Erro no Webhook:', error);
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

export default router;
