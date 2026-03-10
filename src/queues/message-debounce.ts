import { Queue, Worker, Job } from 'bullmq';
import redis from '../lib/redis';
import { createRedisConnection } from '../lib/redis';
import { runApoloAgent } from '../ai/agents/apolo';
import { runVendedorAgent } from '../ai/agents/vendedor';
import { runAtendenteAgent } from '../ai/agents/atendente';
import { AgentContext, AgentMessage } from '../ai/types';
import { getUser, updateUser, createUser, getAgentRouting } from '../ai/server-tools';
import { addToHistory, getChatHistory } from '../lib/chat-history';
import { enqueueMessages, scheduleFollowUp, cancelPendingFollowUps } from './message-queue';
import { debounceLogger } from '../lib/logger';
import { isWithinBusinessHours, getOutOfHoursMessage } from '../lib/business-hours';

// ==================== Constantes ====================

const DEBOUNCE_DELAY_MS = 1500;
const BUFFER_KEY_PREFIX = 'msg_buffer:';
const META_KEY_PREFIX = 'msg_meta:';
const LOCK_KEY_PREFIX = 'msg_lock:';
const BUFFER_TTL = 120;
const LOCK_TTL = 60;
const MAX_BUFFER_SIZE = 20;
const STALE_JOB_STATES = new Set(['completed', 'failed', 'unknown']);

// ==================== Fila ====================

export const debounceQueue = new Queue('message-debounce', {
    connection: createRedisConnection() as any,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
        removeOnFail: true,
    },
});

// ==================== Types ====================

interface DebounceMetadata {
    sender: string;
    pushName?: string;
    userPhone: string;
}

type UserState = 'lead' | 'qualified' | 'customer' | 'attendant';

type AgentRunner = (message: AgentMessage, context: AgentContext) => Promise<string>;

const AGENT_MAP: Record<UserState, { runner: AgentRunner | null; label: string }> = {
    qualified: { runner: runVendedorAgent, label: 'VENDEDOR (Icaro)' },
    customer: { runner: runAtendenteAgent, label: 'ATENDENTE (Apolo Customer)' },
    lead: { runner: runApoloAgent, label: 'APOLO (SDR)' },
    attendant: { runner: null, label: 'ATENDIMENTO HUMANO' },
};

// ==================== Helpers Redis (atômico via pipeline) ====================

/** Acumula mensagem + metadados de forma atômica para evitar estado inconsistente */
async function atomicBufferPush(
    userPhone: string,
    serialized: string,
    metadata: DebounceMetadata,
): Promise<number> {
    const bufferKey = `${BUFFER_KEY_PREFIX}${userPhone}`;
    const metaKey = `${META_KEY_PREFIX}${userPhone}`;

    const pipeline = redis.pipeline();
    pipeline.rpush(bufferKey, serialized);
    pipeline.expire(bufferKey, BUFFER_TTL);
    pipeline.set(metaKey, JSON.stringify(metadata), 'EX', BUFFER_TTL);
    pipeline.llen(bufferKey);

    const results = await pipeline.exec();
    // llen é o 4° comando (index 3), resultado em [err, value]
    const bufferLen = (results?.[3]?.[1] as number) ?? 0;
    return bufferLen;
}

/** Lê buffer + meta e limpa tudo atomicamente (pop atômico) */
async function atomicBufferFlush(userPhone: string): Promise<{ messages: string[]; metadata: DebounceMetadata | null }> {
    const bufferKey = `${BUFFER_KEY_PREFIX}${userPhone}`;
    const metaKey = `${META_KEY_PREFIX}${userPhone}`;

    // Leitura
    const [rawMessages, metaRaw] = await Promise.all([
        redis.lrange(bufferKey, 0, -1),
        redis.get(metaKey),
    ]);

    // Limpeza atômica
    const pipeline = redis.pipeline();
    pipeline.del(bufferKey);
    pipeline.del(metaKey);
    await pipeline.exec();

    const metadata = metaRaw ? JSON.parse(metaRaw) as DebounceMetadata : null;
    return { messages: rawMessages ?? [], metadata };
}

/** Lock distribuído simples para evitar processamento duplo do mesmo usuário */
async function acquireLock(userPhone: string): Promise<boolean> {
    const lockKey = `${LOCK_KEY_PREFIX}${userPhone}`;
    const result = await redis.set(lockKey, '1', 'EX', LOCK_TTL, 'NX');
    return result === 'OK';
}

async function releaseLock(userPhone: string): Promise<void> {
    await redis.del(`${LOCK_KEY_PREFIX}${userPhone}`);
}

// ==================== Helpers de Negócio ====================

/** Remove job anterior (qualquer estado exceto active) para liberar o jobId */
async function clearPreviousJob(jobId: string, userPhone: string): Promise<'cleared' | 'active' | 'none'> {
    try {
        const existing = await debounceQueue.getJob(jobId);
        if (!existing) return 'none';

        const state = await existing.getState();

        if (state === 'active') {
            debounceLogger.info(`Job ativo para ${userPhone}, mensagem será processada no próximo ciclo`);
            return 'active';
        }

        // delayed, waiting, completed, failed — tudo removível
        await existing.remove();
        const label = state === 'delayed' || state === 'waiting' ? 'Timer resetado' : `Job antigo (${state}) removido`;
        debounceLogger.debug(`${label} para ${userPhone}`);
        return 'cleared';
    } catch {
        return 'none';
    }
}

/** Concatena mensagens do buffer, preservando conteúdo multimodal (imagens) */
function combineMessages(rawMessages: string[]): AgentMessage {
    const textParts: string[] = [];
    let lastMultimodal: AgentMessage | null = null;

    for (const raw of rawMessages) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.some((item: any) => item.type === 'image_url')) {
                // É conteúdo multimodal (imagem) — guardar o mais recente
                lastMultimodal = parsed;
                // Extrair texto da parte multimodal
                const texts = parsed
                    .filter((item: any) => item.type === 'text' && item.text)
                    .map((item: any) => item.text);
                if (texts.length > 0) textParts.push(texts.join(' '));
            } else if (Array.isArray(parsed)) {
                // Array sem imagem — extrair texto
                textParts.push(parsed.map((item: any) => item.text || '').filter(Boolean).join(' '));
            } else {
                textParts.push(raw);
            }
        } catch {
            textParts.push(raw);
        }
    }

    // Se tem conteúdo multimodal, montar resposta com todo o texto + a imagem
    if (lastMultimodal && Array.isArray(lastMultimodal)) {
        const allText = textParts.join('\n').trim();
        const imageItem = lastMultimodal.find((item: any) => item.type === 'image_url');
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
async function resolveUserState(userPhone: string, pushName?: string): Promise<UserState> {
    const userJson = await getUser(userPhone);
    let user: Record<string, unknown> | null = null;

    try {
        if (userJson) {
            const parsed = JSON.parse(userJson);
            if (parsed.status !== 'error' && parsed.status !== 'not_found') user = parsed;
        }
    } catch (e) {
        debounceLogger.error('Erro ao parsear usuario:', e);
    }

    if (!user) {
        debounceLogger.info(`🆕 Novo usuário (${userPhone}). Criando registro...`);
        try {
            const result = JSON.parse(await createUser({ telefone: userPhone, nome_completo: pushName || 'Desconhecido' }));
            if (result.status !== 'error') {
                await updateUser({ telefone: userPhone, situacao: 'nao_respondido' });
            }
        } catch (err) {
            debounceLogger.error(`Erro ao criar usuário ${userPhone}:`, err);
        }
        return 'lead';
    }

    // Atualizar nome se necessário
    const currentName = user.nome_completo as string;
    const shouldUpdateName = pushName && (!currentName || currentName === 'Desconhecido' || currentName.trim() === '');
    await updateUser({
        telefone: userPhone,
        ...(shouldUpdateName ? { nome_completo: pushName } : {}),
    });

    // Verificar override de roteamento
    const override = await getAgentRouting(userPhone);
    if (override === 'vendedor') {
        debounceLogger.info(`🔀 Override ativo → Vendas (${userPhone})`);
        return 'qualified';
    }

    // if (user.needs_attendant) return 'attendant'; // Removido para permitir que o bot continue respondendo

    if (user.situacao === 'cliente') return 'customer';
    if (user.qualificacao) return 'qualified';
    return 'lead';
}

/** Envia resposta do agente via BullMQ */
async function sendAgentResponse(responseText: string, sender: string, userPhone: string): Promise<void> {
    if (!responseText) return;

    await addToHistory(userPhone, 'assistant', responseText);

    const messages = responseText.split('|||').map(m => m.trim()).filter(m => m.length > 0);
    if (messages.length === 0) return;

    const segments = messages.map((msg, i) => ({
        content: msg,
        type: 'text' as const,
        delay: i === 0 ? 0 : 1500,
    }));

    await enqueueMessages({ phone: sender, messages: segments, context: 'agent-response' });

    // Cancelar nudges anteriores e agendar novo follow-up de 5 minutos
    await cancelPendingFollowUps(userPhone);
    const nudgeMsg = 'Oi, só pra ver se você conseguiu ler a mensagem acima! Posso te ajudar com mais alguma coisa? 😊';
    await scheduleFollowUp(
        userPhone,
        nudgeMsg,
        5 * 60 * 1000,
        'nudge'
    );
}

/** Envia mensagem de fallback quando AI falha */
async function sendFallback(sender: string, userPhone: string): Promise<void> {
    try {
        await enqueueMessages({
            phone: sender,
            messages: [{
                content: 'Tivemos uma instabilidade rápida no sistema. Nossa equipe já foi notificada. Um atendente humano responderá em breve.',
                type: 'text',
                delay: 0,
            }],
            context: 'fallback-error',
        });
        await updateUser({ telefone: userPhone, observacoes: '[FALHA DE SISTEMA] Erro no bot, encaminhado para humano' });
    } catch (err) {
        debounceLogger.error('Falha crítica no fallback:', err);
    }
}

// ==================== API Pública ====================

/**
 * Acumula mensagem no buffer Redis e (re)agenda o processamento com debounce.
 * Operações Redis são atômicas via pipeline. Protege contra buffer overflow.
 */
export async function bufferAndDebounce(
    userPhone: string,
    message: string | Array<{ type: string; text?: string; image_url?: { url: string } }>,
    metadata: DebounceMetadata,
): Promise<void> {
    const serialized = typeof message === 'string' ? message : JSON.stringify(message);

    // 1. Push atômico no buffer
    const bufferLen = await atomicBufferPush(userPhone, serialized, metadata);
    debounceLogger.info(`+1 mensagem para ${userPhone} (buffer: ${bufferLen})`);

    // 2. Proteção contra flood — se buffer muito grande, forçar processamento
    if (bufferLen >= MAX_BUFFER_SIZE) {
        debounceLogger.warn(`⚠️ Buffer cheio (${bufferLen}) para ${userPhone}. Forçando processamento imediato.`);
        const jobId = `debounce-${userPhone}`;
        await clearPreviousJob(jobId, userPhone);
        await debounceQueue.add('process-buffered', { userPhone }, { jobId, delay: 0 });
        return;
    }

    // 3. Limpar job anterior e criar novo com delay (reseta o timer)
    const jobId = `debounce-${userPhone}`;
    const status = await clearPreviousJob(jobId, userPhone);

    if (status === 'active') return; // Job já processando, mensagem fica no buffer pro próximo ciclo

    await debounceQueue.add('process-buffered', { userPhone }, { jobId, delay: DEBOUNCE_DELAY_MS });
    debounceLogger.info(`Timer ${DEBOUNCE_DELAY_MS}ms para ${userPhone}`);
}

// ==================== Worker ====================

export function startDebounceWorker(): Worker {
    const worker = new Worker('message-debounce', async (job: Job) => {
        const { userPhone } = job.data as { userPhone: string };
        const log = debounceLogger.withTrace(`db-${userPhone.slice(-4)}-${Date.now().toString(36)}`);
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

            // 4. Verificar horário comercial (Apenas capturar)
            const isOutOfHours = !isWithinBusinessHours();
            if (isOutOfHours) {
                log.info(`🕐 Fora do horário comercial para ${userPhone}. A IA cuidará da mensagem.`);
            }

            // 5. Resolver estado + roteamento
            const userState = await log.timed('resolveUserState', () => resolveUserState(userPhone, metadata.pushName));
            const { runner, label } = AGENT_MAP[userState];
            log.info(`🤖 → ${label}`);

            if (!runner) {
                log.warn(`⚠️ Nenhum agente configurado para responder estado: ${userState}`);
                return;
            }

            // 6. Chamar AI
            const history = await log.timed('getChatHistory', () => getChatHistory(userPhone));
            const attendantReason = await log.timed('getAttendantReason', () => redis.get(`attendant_requested:${userPhone}`));

            const context: AgentContext = {
                userId: metadata.sender,
                userName: metadata.pushName,
                userPhone,
                history,
                outOfHours: isOutOfHours,
                ...(attendantReason ? { attendantRequestedReason: attendantReason } : {})
            };

            try {
                const response = await log.timed(`AI ${label}`, () => runner(combinedMessage, context));
                await log.timed('sendAgentResponse', () => sendAgentResponse(response, metadata.sender, userPhone));
            } catch (aiError) {
                log.error(`❌ Erro AI para ${userPhone}:`, aiError);
                await sendFallback(metadata.sender, userPhone);
            }

            totalTimer.end(`${rawMessages.length} msg(s) de ${userPhone}`);
            log.info(`✅ Concluído para ${userPhone}`);
        } finally {
            // SEMPRE libera o lock, mesmo em caso de erro
            await releaseLock(userPhone);
        }
    }, {
        connection: createRedisConnection() as any,
        concurrency: 5,
    });

    worker.on('completed', (job) => {
        debounceLogger.debug(`Job ${job.id} concluído`);
    });

    worker.on('failed', (job, err) => {
        debounceLogger.error(`❌ Job ${job?.id} falhou: ${err.message}`);
    });

    return worker;
}
