"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const apolo_1 = require("../ai/agents/apolo");
const vendedor_1 = require("../ai/agents/vendedor");
const atendente_1 = require("../ai/agents/atendente");
const server_tools_1 = require("../ai/server-tools");
const chat_history_1 = require("../lib/chat-history");
const redis_1 = __importDefault(require("../lib/redis"));
const socket_1 = require("../lib/socket");
const message_queue_1 = require("../queues/message-queue");
const message_parser_1 = require("../lib/message-parser");
const router = (0, express_1.Router)();
router.get('/webhook/whatsapp', (_req, res) => {
    res.json({
        status: 'online',
        message: 'Bot Backend Webhook is active and ready to receive POST requests',
        timestamp: new Date().toISOString(),
    });
});
router.post('/webhook/whatsapp', async (req, res) => {
    try {
        const apiKeyHeader = req.headers['apikey'] || req.headers['authorization']?.replace('Bearer ', '');
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
        const message = await (0, message_parser_1.parseIncomingMessage)(msgData, base64FromBody);
        // Identify the user phone — priorizar número real, aceitar LID como fallback
        // ATENÇÃO: body.sender é o número da INSTÂNCIA, NÃO do usuário!
        const candidatos = [
            body.data?.key?.senderPn, // Evolution API v2: número real quando remoteJid é LID
            body.senderpn,
            body.data?.senderpn,
            body.senderPhone,
            body.data?.senderPhone,
            body.data?.key?.participant,
            body.data?.participant,
            body.data?.key?.remoteJid, // Último recurso — pode ser LID
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
        (0, message_queue_1.cancelPendingFollowUps)(userPhone).catch(err => console.error('[Webhook] Failed to cancel follow-ups:', err));
        // Registrar atividade no Redis
        redis_1.default.set(`last_activity:${userPhone}`, Date.now().toString(), 'EX', 86400).catch(() => { });
        // 0. Salvar mensagem do usuário no histórico
        await (0, chat_history_1.addToHistory)(userPhone, 'user', message);
        // Publish INCOMING message to Redis for Real-time
        const incomingSocketMsg = { chatId: sender, ...body.data };
        (0, socket_1.notifySocketServer)('chat-updates', incomingSocketMsg).catch(err => console.error('[Webhook] Socket notification failed:', err));
        // Adicionar à fila de sincronização de contexto
        redis_1.default.zadd('context_sync_queue', Date.now(), userPhone).catch(err => console.error('[Webhook] Erro ao adicionar à fila de contexto:', err));
        redis_1.default.del(`context_nudge_sent:${userPhone}`).catch(() => { });
        // 1. Determinar o Estado do Usuário (Routing Logic)
        let userState = 'lead';
        const userJson = await (0, server_tools_1.getUser)(userPhone);
        let user = null;
        try {
            if (userJson) {
                const parsed = JSON.parse(userJson);
                if (parsed.status !== 'error' && parsed.status !== 'not_found')
                    user = parsed;
            }
        }
        catch (e) {
            console.error('Erro ao parsear usuario:', e);
        }
        if (!user) {
            console.log(`[Router] Novo usuário detectado (${userPhone}). Criando registro...`);
            try {
                const createResult = await (0, server_tools_1.createUser)({ telefone: userPhone, nome_completo: pushName || 'Desconhecido' });
                const parsedResult = JSON.parse(createResult);
                if (parsedResult.status === 'error') {
                    console.error(`[Router] Falha ao criar usuário: ${parsedResult.message}`);
                }
                else {
                    await (0, server_tools_1.updateUser)({ telefone: userPhone, situacao: 'nao_respondido' });
                }
            }
            catch (createError) {
                console.error(`[Router] Exceção crítica ao criar usuário:`, createError);
            }
            userState = 'lead';
        }
        else {
            const currentName = user.nome_completo;
            const shouldUpdateName = pushName && (!currentName || currentName === 'Desconhecido' || currentName.trim() === '');
            if (shouldUpdateName) {
                await (0, server_tools_1.updateUser)({ telefone: userPhone, nome_completo: pushName });
                user.nome_completo = pushName;
            }
            else {
                await (0, server_tools_1.updateUser)({ telefone: userPhone });
            }
            if (user.situacao === 'cliente') {
                userState = 'customer';
            }
            else if (user.qualificacao) {
                userState = 'qualified';
            }
            else {
                userState = 'lead';
            }
        }
        // 1.5 Verificar Override de Roteamento
        const routingOverride = await (0, server_tools_1.getAgentRouting)(userPhone);
        if (routingOverride === 'vendedor') {
            console.log(`[Router] Override ativo: Redirecionando para Vendas.`);
            userState = 'qualified';
        }
        // Contexto compartilhado
        const history = await (0, chat_history_1.getChatHistory)(userPhone);
        const context = {
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
                    responseText = await (0, vendedor_1.runVendedorAgent)(message, context);
                    break;
                case 'customer':
                    console.log(`[Router] Direcionando para ATENDENTE (Apolo Customer)`);
                    responseText = await (0, atendente_1.runAtendenteAgent)(message, context);
                    break;
                case 'lead':
                default:
                    console.log(`[Router] Direcionando para APOLO (SDR)`);
                    responseText = await (0, apolo_1.runApoloAgent)(message, context);
                    break;
            }
            // 3. Salvar resposta e Enviar via BullMQ
            if (responseText) {
                await (0, chat_history_1.addToHistory)(userPhone, 'assistant', responseText);
            }
            const messages = responseText.split('|||').map((m) => m.trim()).filter((m) => m.length > 0);
            if (messages.length > 0) {
                const segments = messages.map((msg, index) => ({
                    content: msg,
                    type: 'text',
                    delay: index === 0 ? 0 : 1500,
                }));
                // ENFILEIRA via BullMQ
                await (0, message_queue_1.enqueueMessages)({
                    phone: sender,
                    messages: segments,
                    context: 'agent-response',
                });
            }
        }
        catch (routingError) {
            console.error(`[Router] Exceção na LLM ou Roteamento do cliente ${userPhone}:`, routingError);
            // Salva-vidas: mensagem fixa de transbordo caso a OpenAI ou LLM falhe
            try {
                await (0, message_queue_1.enqueueMessages)({
                    phone: sender,
                    messages: [{ content: 'Tivemos uma instabilidade rápida no sistema. Nossa equipe já foi notificada. Um atendente humano responderá em breve.', type: 'text', delay: 0 }],
                    context: 'fallback-error'
                });
                await (0, server_tools_1.updateUser)({ telefone: userPhone, observacoes: '[FALHA DE SISTEMA] Erro na requisição do bot, encaminhado para humano' });
            }
            catch (fallbackErr) {
                console.error('[Router] Falha crítica ao tentar enviar mensagem de fallback', fallbackErr);
            }
        }
        res.json({ status: 'success' });
    }
    catch (error) {
        console.error('Erro no Webhook:', error);
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
exports.default = router;
//# sourceMappingURL=webhook.js.map