import { Router, Request, Response } from 'express';
import { runApoloAgent } from '../ai/agents/apolo';
import { runVendedorAgent } from '../ai/agents/vendedor';
import { runAtendenteAgent } from '../ai/agents/atendente';
import { AgentContext } from '../ai/types';
import { getUser, updateUser, createUser, getAgentRouting } from '../ai/server-tools';
import { addToHistory, getChatHistory } from '../lib/chat-history';
import redis from '../lib/redis';
import { notifySocketServer } from '../lib/socket';
import { enqueueMessages, cancelPendingFollowUps } from '../queues/message-queue';
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

        // Identify the user phone — priorizar campos com número real, rejeitar LIDs
        const candidatos = [
            body.senderpn,
            body.data?.senderpn,
            body.senderPhone,
            body.data?.senderPhone,
            body.data?.key?.participant,     // Em grupos, participant tem o número real
            body.data?.participant,
            body.data?.key?.remoteJid,       // Último recurso — pode ser LID
        ].filter(Boolean);

        // Pegar o primeiro que NÃO seja LID nem grupo
        let sender = candidatos.find(s => !s.includes('@lid') && !s.includes('@g.us'));

        // Se só sobrou LID, logar e descartar
        if (!sender && candidatos.length > 0) {
            console.log('[Webhook] ⚠️ Todos os candidatos são LID/grupo, ignorando:', candidatos);
            console.log('[Webhook] Body keys:', JSON.stringify(Object.keys(body)));
            console.log('[Webhook] Data keys:', JSON.stringify(Object.keys(body.data || {})));
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

        // 0. Salvar mensagem do usuário no histórico
        await addToHistory(userPhone, 'user', message);

        // Publish INCOMING message to Redis for Real-time
        const incomingSocketMsg = { chatId: sender, ...body.data };
        notifySocketServer('chat-updates', incomingSocketMsg).catch(err =>
            console.error('[Webhook] Socket notification failed:', err)
        );

        // Adicionar à fila de sincronização de contexto
        redis.zadd('context_sync_queue', Date.now(), userPhone).catch(err =>
            console.error('[Webhook] Erro ao adicionar à fila de contexto:', err)
        );
        redis.del(`context_nudge_sent:${userPhone}`).catch(() => { });

        // 1. Determinar o Estado do Usuário (Routing Logic)
        let userState: 'lead' | 'qualified' | 'customer' = 'lead';
        const userJson = await getUser(userPhone);
        let user: Record<string, unknown> | null = null;

        try {
            if (userJson) {
                const parsed = JSON.parse(userJson);
                if (parsed.status !== 'error' && parsed.status !== 'not_found') user = parsed;
            }
        } catch (e) { console.error('Erro ao parsear usuario:', e); }

        if (!user) {
            console.log(`[Router] Novo usuário detectado (${userPhone}). Criando registro...`);
            try {
                const createResult = await createUser({ telefone: userPhone, nome_completo: pushName || 'Desconhecido' });
                const parsedResult = JSON.parse(createResult);
                if (parsedResult.status === 'error') {
                    console.error(`[Router] Falha ao criar usuário: ${parsedResult.message}`);
                } else {
                    await updateUser({ telefone: userPhone, situacao: 'nao_respondido' });
                }
            } catch (createError) {
                console.error(`[Router] Exceção crítica ao criar usuário:`, createError);
            }
            userState = 'lead';
        } else {
            const currentName = user.nome_completo as string;
            const shouldUpdateName = pushName && (!currentName || currentName === 'Desconhecido' || currentName.trim() === '');
            if (shouldUpdateName) {
                await updateUser({ telefone: userPhone, nome_completo: pushName });
                user.nome_completo = pushName;
            } else {
                await updateUser({ telefone: userPhone });
            }

            if (user.situacao === 'cliente') { userState = 'customer'; }
            else if (user.qualificacao) { userState = 'qualified'; }
            else { userState = 'lead'; }
        }

        // 1.5 Verificar Override de Roteamento
        const routingOverride = await getAgentRouting(userPhone);
        if (routingOverride === 'vendedor') {
            console.log(`[Router] Override ativo: Redirecionando para Vendas.`);
            userState = 'qualified';
        }

        // Contexto compartilhado
        const history = await getChatHistory(userPhone);
        const context: AgentContext = {
            userId: sender,
            userName: pushName,
            userPhone: userPhone,
            history: history,
        };

        let responseText = '';

        try {
            // 2. Despachar para o Agente Correto
            switch (userState) {
                case 'qualified':
                    console.log(`[Router] Direcionando para VENDEDOR (Icaro)`);
                    responseText = await runVendedorAgent(message, context);
                    break;
                case 'customer':
                    console.log(`[Router] Direcionando para ATENDENTE (Apolo Customer)`);
                    responseText = await runAtendenteAgent(message, context);
                    break;
                case 'lead':
                default:
                    console.log(`[Router] Direcionando para APOLO (SDR)`);
                    responseText = await runApoloAgent(message, context);
                    break;
            }

            // 3. Salvar resposta e Enviar via BullMQ
            if (responseText) {
                await addToHistory(userPhone, 'assistant', responseText);
            }

            const messages = responseText.split('|||').map((m: string) => m.trim()).filter((m: string) => m.length > 0);
            if (messages.length > 0) {
                const segments = messages.map((msg, index) => ({
                    content: msg,
                    type: 'text' as const,
                    delay: index === 0 ? 0 : 1500,
                }));

                // ENFILEIRA via BullMQ
                await enqueueMessages({
                    phone: sender,
                    messages: segments,
                    context: 'agent-response',
                });
            }
        } catch (routingError) {
            console.error(`[Router] Exceção na LLM ou Roteamento do cliente ${userPhone}:`, routingError);

            // Salva-vidas: mensagem fixa de transbordo caso a OpenAI ou LLM falhe
            try {
                await enqueueMessages({
                    phone: sender,
                    messages: [{ content: 'Tivemos uma instabilidade rápida no sistema. Nossa equipe já foi notificada. Um atendente humano responderá em breve.', type: 'text', delay: 0 }],
                    context: 'fallback-error'
                });
                await updateUser({ telefone: userPhone, observacoes: '[FALHA DE SISTEMA] Erro na requisição do bot, encaminhado para humano' });
            } catch (fallbackErr) {
                console.error('[Router] Falha crítica ao tentar enviar mensagem de fallback', fallbackErr);
            }
        }

        res.json({ status: 'success' });
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
