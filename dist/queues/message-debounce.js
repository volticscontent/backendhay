"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.debounceQueue = void 0;
exports.bufferAndDebounce = bufferAndDebounce;
exports.startDebounceWorker = startDebounceWorker;
const bullmq_1 = require("bullmq");
const redis_1 = __importDefault(require("../lib/redis"));
const redis_2 = require("../lib/redis");
const index_1 = require("../ai/agents/apolo/index");
const vendedor_1 = require("../ai/agents/vendedor");
const atendente_1 = require("../ai/agents/atendente");
const server_tools_1 = require("../ai/server-tools");
const chat_history_1 = require("../lib/chat-history");
const message_queue_1 = require("./message-queue");
const logger_1 = require("../lib/logger");
const business_hours_1 = require("../lib/business-hours");
// ==================== Constantes ====================
const DEBOUNCE_DELAY_MS = 1500;
const BUFFER_KEY_PREFIX = 'msg_buffer:';
const META_KEY_PREFIX = 'msg_meta:';
const LOCK_KEY_PREFIX = 'msg_lock:';
const BUFFER_TTL = 120;
const LOCK_TTL = 180;
const MAX_BUFFER_SIZE = 20;
const RECHECK_FLAG_PREFIX = 'msg_recheck:';
// ==================== Fila ====================
exports.debounceQueue = new bullmq_1.Queue('message-debounce', {
    connection: (0, redis_2.createRedisConnection)(),
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
        removeOnFail: true,
    },
});
const AGENT_MAP = {
    qualified: { runner: vendedor_1.runVendedorAgent, label: 'VENDEDOR (Icaro)' },
    customer: { runner: atendente_1.runAtendenteAgent, label: 'ATENDENTE (Apolo Customer)' },
    lead: { runner: index_1.runApoloAgent, label: 'APOLO (SDR)' },
    attendant: { runner: null, label: 'ATENDIMENTO HUMANO' },
};
// ==================== Helpers Redis (atômico via pipeline) ====================
/** Acumula mensagem + metadados de forma atômica para evitar estado inconsistente */
async function atomicBufferPush(userPhone, serialized, metadata) {
    const bufferKey = `${BUFFER_KEY_PREFIX}${userPhone}`;
    const metaKey = `${META_KEY_PREFIX}${userPhone}`;
    const pipeline = redis_1.default.pipeline();
    pipeline.rpush(bufferKey, serialized);
    pipeline.expire(bufferKey, BUFFER_TTL);
    pipeline.set(metaKey, JSON.stringify(metadata), 'EX', BUFFER_TTL);
    pipeline.llen(bufferKey);
    const results = await pipeline.exec();
    // llen é o 4° comando (index 3), resultado em [err, value]
    const bufferLen = results?.[3]?.[1] ?? 0;
    return bufferLen;
}
/** Lua script para flush atômico — leitura + deleção numa única operação Redis (sem race condition) */
const FLUSH_LUA_SCRIPT = `
  local msgs = redis.call('lrange', KEYS[1], 0, -1)
  local meta = redis.call('get', KEYS[2])
  redis.call('del', KEYS[1], KEYS[2])
  return {msgs, meta or ''}
`;
/** Lê buffer + meta e limpa tudo atomicamente via Lua (verdadeiro pop atômico) */
async function atomicBufferFlush(userPhone) {
    const bufferKey = `${BUFFER_KEY_PREFIX}${userPhone}`;
    const metaKey = `${META_KEY_PREFIX}${userPhone}`;
    const result = await redis_1.default.eval(FLUSH_LUA_SCRIPT, 2, // número de KEYS
    bufferKey, // KEYS[1]
    metaKey);
    const rawMessages = result?.[0] ?? [];
    const metaRaw = result?.[1] || null;
    const metadata = metaRaw ? JSON.parse(metaRaw) : null;
    return { messages: rawMessages, metadata };
}
/** Lock distribuído simples para evitar processamento duplo do mesmo usuário */
async function acquireLock(userPhone) {
    const lockKey = `${LOCK_KEY_PREFIX}${userPhone}`;
    const result = await redis_1.default.set(lockKey, '1', 'EX', LOCK_TTL, 'NX');
    return result === 'OK';
}
async function releaseLock(userPhone) {
    await redis_1.default.del(`${LOCK_KEY_PREFIX}${userPhone}`);
}
// ==================== Helpers de Negócio ====================
/** Remove job pendente para o usuário de forma eficiente (O(1)) via Job ID fixo */
async function clearPendingJobs(userPhone) {
    try {
        const jobId = `debounce-${userPhone}`;
        const job = await exports.debounceQueue.getJob(jobId);
        if (job) {
            await job.remove().catch(() => { });
            logger_1.debounceLogger.debug(`Timer resetado (Job removido) para ${userPhone}`);
        }
    }
    catch (err) {
        logger_1.debounceLogger.error(`Erro ao limpar job ${userPhone}:`, err);
    }
}
/** Concatena mensagens do buffer, preservando conteúdo multimodal (imagens) */
function combineMessages(rawMessages) {
    const textParts = [];
    let lastMultimodal = null;
    for (const raw of rawMessages) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.some((item) => item.type === 'image_url')) {
                // É conteúdo multimodal (imagem) — guardar o mais recente
                lastMultimodal = parsed;
                // Extrair texto da parte multimodal
                const texts = parsed
                    .filter((item) => item.type === 'text' && item.text)
                    .map((item) => item.text);
                if (texts.length > 0)
                    textParts.push(texts.join(' '));
            }
            else if (Array.isArray(parsed)) {
                // Array sem imagem — extrair texto
                textParts.push(parsed.map((item) => item.text || '').filter(Boolean).join(' '));
            }
            else {
                textParts.push(raw);
            }
        }
        catch {
            textParts.push(raw);
        }
    }
    // Se tem conteúdo multimodal, montar resposta com todo o texto + a imagem
    if (lastMultimodal && Array.isArray(lastMultimodal)) {
        const allText = textParts.join('\n').trim();
        const imageItem = lastMultimodal.find((item) => item.type === 'image_url');
        if (imageItem) {
            return [
                { type: 'text', text: allText || 'Analise esta imagem enviada pelo cliente.' },
                imageItem,
            ];
        }
    }
    return textParts.join('\n');
}
/** Resolve o estado do usuário a partir do DB */
async function resolveUserState(userPhone, pushName) {
    // 1. Check for routing override in Redis
    const routingOverride = await (0, server_tools_1.getAgentRouting)(userPhone);
    if (routingOverride === 'vendedor')
        return 'qualified';
    if (routingOverride === 'atendente')
        return 'customer';
    if (routingOverride === 'atendimento')
        return 'attendant';
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
        logger_1.debounceLogger.error('Erro ao parsear usuario:', e);
    }
    if (!user) {
        logger_1.debounceLogger.info(`🆕 Novo usuário (${userPhone}). Criando registro...`);
        try {
            const result = JSON.parse(await (0, server_tools_1.createUser)({ telefone: userPhone, nome_completo: pushName || 'Desconhecido' }));
            if (result.status !== 'error') {
                await (0, server_tools_1.updateUser)({ telefone: userPhone, situacao: 'nao_respondido' });
            }
        }
        catch (err) {
            logger_1.debounceLogger.error(`Erro ao criar usuário ${userPhone}:`, err);
        }
        return 'lead';
    }
    // Atualizar nome se necessário
    const currentName = user.nome_completo;
    const shouldUpdateName = pushName && (!currentName || currentName === 'Desconhecido' || currentName.trim() === '');
    await (0, server_tools_1.updateUser)({
        telefone: userPhone,
        ...(shouldUpdateName ? { nome_completo: pushName } : {}),
    });
    // Fora do horário comercial? apenas capturamos para passar para a IA
    const isOutOfHours = !(0, business_hours_1.isWithinBusinessHours)();
    if (isOutOfHours) {
        logger_1.debounceLogger.info(`🕐 Fora do horário comercial para ${userPhone}. A IA continuará o atendimento.`);
    }
    // Se o usuário já estiver em atendimento humano, o AGENT_MAP['attendant'] retornará runner null
    if (user.situacao === 'cliente' || user.cliente === true)
        return 'customer';
    if (user.situacao === 'qualificado' || user.qualificacao)
        return 'qualified';
    return 'lead';
}
/** Envia resposta do agente via BullMQ */
async function sendAgentResponse(responseText, sender, userPhone, agentLabel = 'BOT') {
    if (!responseText)
        return;
    await (0, chat_history_1.addToHistory)(userPhone, 'assistant', responseText);
    const messages = responseText.split('|||').map(m => m.trim()).filter(m => m.length > 0);
    if (messages.length === 0)
        return;
    const segments = messages.map((msg, i) => ({
        content: msg,
        type: 'text',
        delay: i === 0 ? 0 : 1500,
    }));
    await (0, message_queue_1.enqueueMessages)({ phone: sender, messages: segments, context: `agent-response|${agentLabel}` });
    // Cancelar nudges anteriores e agendar novo follow-up de 5 minutos
    await (0, message_queue_1.cancelPendingFollowUps)(userPhone);
    const nudgeMsg = 'Oi, só pra ver se você conseguiu ler a mensagem acima! Posso te ajudar com mais alguma coisa? 😊';
    await (0, message_queue_1.scheduleFollowUp)(userPhone, nudgeMsg, 5 * 60 * 1000, 'nudge');
}
/** Envia mensagem de fallback quando AI falha */
async function sendFallback(sender, userPhone) {
    try {
        await (0, message_queue_1.enqueueMessages)({
            phone: sender,
            messages: [{
                    content: 'Tivemos uma instabilidade rápida no sistema. Nossa equipe já foi notificada. Um atendente humano responderá em breve.',
                    type: 'text',
                    delay: 0,
                }],
            context: 'fallback-error',
        });
        await (0, server_tools_1.updateUser)({ telefone: userPhone, observacoes: '[FALHA DE SISTEMA] Erro no bot, encaminhado para humano' });
    }
    catch (err) {
        logger_1.debounceLogger.error('Falha crítica no fallback:', err);
    }
}
// ==================== API Pública ====================
/**
 * Acumula mensagem no buffer Redis e (re)agenda o processamento com debounce.
 * Operações Redis são atômicas via pipeline. Protege contra buffer overflow.
 */
async function bufferAndDebounce(userPhone, message, metadata) {
    const serialized = typeof message === 'string' ? message : JSON.stringify(message);
    // 1. Push atômico no buffer
    const bufferLen = await atomicBufferPush(userPhone, serialized, metadata);
    logger_1.debounceLogger.info(`+1 mensagem para ${userPhone} (buffer: ${bufferLen})`);
    // 2. Proteção contra flood
    if (bufferLen >= MAX_BUFFER_SIZE) {
        logger_1.debounceLogger.warn(`⚠️ Buffer cheio (${bufferLen}) para ${userPhone}. Forçando processamento imediato.`);
        await clearPendingJobs(userPhone);
        await exports.debounceQueue.add('process-buffered', { userPhone }, { delay: 0 });
        return;
    }
    // 3. Verificar se já existe um worker ATIVO processando este usuário
    const lockKey = `${LOCK_KEY_PREFIX}${userPhone}`;
    const isProcessing = await redis_1.default.exists(lockKey);
    if (isProcessing) {
        // Sinalizar que o worker atual deve fazer re-check ao terminar
        await redis_1.default.set(`${RECHECK_FLAG_PREFIX}${userPhone}`, '1', 'EX', 60);
        logger_1.debounceLogger.info(`Worker ocupado para ${userPhone}. Sinalizando re-check.`);
        return;
    }
    // 4. Limpar job pendente (timer) e agendar novo com delay (reset do timer)
    await clearPendingJobs(userPhone);
    const jobId = `debounce-${userPhone}`;
    await exports.debounceQueue.add('process-buffered', { userPhone }, {
        jobId,
        delay: DEBOUNCE_DELAY_MS
    });
    logger_1.debounceLogger.info(`Timer ${DEBOUNCE_DELAY_MS}ms iniciado para ${userPhone}`);
}
// ==================== Worker ====================
function startDebounceWorker() {
    const worker = new bullmq_1.Worker('message-debounce', async (job) => {
        const { userPhone } = job.data;
        const log = logger_1.debounceLogger.withTrace(`db-${userPhone.slice(-4)}-${Date.now().toString(36)}`);
        const totalTimer = log.timer('Pipeline total');
        // 1. Lock distribuído — evita processamento duplo
        const locked = await log.timed('acquireLock', () => acquireLock(userPhone));
        if (!locked) {
            log.warn(`🔒 Lock ocupado para ${userPhone}. Re-enfileirando...`);
            throw new Error('Lock occupied — will retry');
        }
        try {
            log.info(`🔄 Processando mensagens de ${userPhone}...`);
            // 2. Flush atômico do buffer
            const { messages: rawMessages, metadata } = await log.timed('bufferFlush', () => atomicBufferFlush(userPhone));
            if (rawMessages.length === 0 || !metadata) {
                log.info(`Buffer vazio para ${userPhone}, nada a processar.`);
                return;
            }
            // 3. Concatenar mensagens
            const combinedMessage = combineMessages(rawMessages);
            const logMsg = typeof combinedMessage === 'string'
                ? `"${combinedMessage.substring(0, 100)}${combinedMessage.length > 100 ? '...' : ''}"`
                : `[Multimodal: ${rawMessages.length} parte(s)]`;
            log.info(`📨 ${rawMessages.length} msg(s) de ${userPhone}: ${logMsg}`);
            // 5. Resolver estado + roteamento
            const userState = await log.timed('resolveUserState', () => resolveUserState(userPhone, metadata.pushName));
            const isOutOfHours = !(0, business_hours_1.isWithinBusinessHours)(); // Mantemos o check para o contexto da IA
            const { runner, label } = AGENT_MAP[userState];
            log.info(`🤖 → ${label}`);
            if (!runner) {
                log.warn(`⚠️ Nenhum agente configurado para responder estado: ${userState}`);
                return;
            }
            // 6. Chamar AI
            const history = await log.timed('getChatHistory', () => (0, chat_history_1.getChatHistory)(userPhone));
            const attendantReason = await log.timed('getAttendantReason', () => redis_1.default.get(`attendant_requested:${userPhone}`));
            const context = {
                userId: metadata.sender,
                userName: metadata.pushName,
                userPhone,
                history,
                outOfHours: isOutOfHours,
                ...(attendantReason ? { attendantRequestedReason: attendantReason } : {})
            };
            try {
                const response = await log.timed(`AI ${label}`, () => runner(combinedMessage, context));
                await log.timed('sendAgentResponse', () => sendAgentResponse(response, metadata.sender, userPhone, label));
            }
            catch (aiError) {
                log.error(`❌ Erro AI para ${userPhone}:`, aiError);
                await sendFallback(metadata.sender, userPhone);
            }
            totalTimer.end(`${rawMessages.length} msg(s) de ${userPhone}`);
            log.info(`✅ Concluído para ${userPhone}`);
        }
        finally {
            // Re-check: se chegaram msgs durante o processamento (verificado via flag ou buffer residual)
            try {
                const recheckFlag = await redis_1.default.get(`${RECHECK_FLAG_PREFIX}${userPhone}`);
                const remainingCount = await redis_1.default.llen(`${BUFFER_KEY_PREFIX}${userPhone}`);
                if (recheckFlag === '1' || remainingCount > 0) {
                    await redis_1.default.del(`${RECHECK_FLAG_PREFIX}${userPhone}`);
                    const recheckJobId = `debounce-${userPhone}-recheck`;
                    await exports.debounceQueue.add('process-buffered', { userPhone }, {
                        jobId: recheckJobId,
                        delay: 1000,
                    }).catch(() => { });
                    log.info(`🔄 Re-agendando via RECHECK ID para ${userPhone}`);
                }
            }
            catch (recheckErr) {
                log.error(`Erro no re-check de buffer:`, recheckErr);
            }
            // SEMPRE libera o lock
            await releaseLock(userPhone);
        }
    }, {
        connection: (0, redis_2.createRedisConnection)(),
        concurrency: 5,
    });
    worker.on('completed', (job) => {
        logger_1.debounceLogger.debug(`Job ${job.id} concluído`);
    });
    worker.on('failed', (job, err) => {
        logger_1.debounceLogger.error(`❌ Job ${job?.id} falhou: ${err.message}`);
    });
    return worker;
}
//# sourceMappingURL=message-debounce.js.map