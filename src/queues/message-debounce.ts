import { Queue, Worker, Job } from 'bullmq';
import redis from '../lib/redis';
import { runApoloAgent } from '../ai/agents/apolo';
import { runVendedorAgent } from '../ai/agents/vendedor';
import { runAtendenteAgent } from '../ai/agents/atendente';
import { AgentContext } from '../ai/types';
import { getUser, updateUser, createUser, getAgentRouting } from '../ai/server-tools';
import { addToHistory, getChatHistory } from '../lib/chat-history';
import { enqueueMessages } from './message-queue';

// ==================== Constantes ====================
const DEBOUNCE_DELAY_MS = 2000; // 2 segundos de debounce
const BUFFER_KEY_PREFIX = 'msg_buffer:';
const META_KEY_PREFIX = 'msg_meta:';
const BUFFER_TTL = 60; // 60 segundos de TTL para segurança

// ==================== Fila de Debounce ====================
export const debounceQueue = new Queue('message-debounce', {
    connection: redis as any,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 3600 * 24 },
    },
});

// ==================== Interface ====================
interface DebounceMetadata {
    sender: string;
    pushName?: string;
    userPhone: string;
}

// ==================== Funções Públicas ====================

/**
 * Acumula uma mensagem no buffer Redis e agenda (ou re-agenda) o processamento.
 * Se já existe um job de debounce para esse telefone, ele é removido e um novo é criado,
 * efetivamente resetando o timer de debounce.
 */
export async function bufferAndDebounce(
    userPhone: string,
    message: string | Array<{ type: string; text?: string; image_url?: { url: string } }>,
    metadata: DebounceMetadata
): Promise<void> {
    const bufferKey = `${BUFFER_KEY_PREFIX}${userPhone}`;
    const metaKey = `${META_KEY_PREFIX}${userPhone}`;

    // Serializar a mensagem para armazenar no Redis
    const serialized = typeof message === 'string' ? message : JSON.stringify(message);

    // Acumular mensagem no buffer (lista Redis)
    await redis.rpush(bufferKey, serialized);
    await redis.expire(bufferKey, BUFFER_TTL);

    // Salvar/atualizar metadados (sempre sobrescreve com os mais recentes)
    await redis.set(metaKey, JSON.stringify(metadata), 'EX', BUFFER_TTL);

    // Contar mensagens no buffer
    const bufferLen = await redis.llen(bufferKey);
    console.log(`[Debounce] Mensagem acumulada para ${userPhone} (total no buffer: ${bufferLen})`);

    // Remover job de debounce anterior (se existir) e criar um novo
    const jobId = `debounce-${userPhone}`;

    try {
        // Tenta remover o job existente (pode estar delayed)
        const existingJob = await debounceQueue.getJob(jobId);
        if (existingJob) {
            const state = await existingJob.getState();
            // Só remove se estiver em espera (delayed/waiting), não se estiver ativo
            if (state === 'delayed' || state === 'waiting') {
                await existingJob.remove();
                console.log(`[Debounce] Timer resetado para ${userPhone}`);
            } else if (state === 'active') {
                // Job já está sendo processado, esta mensagem nova será tratada em um próximo ciclo
                console.log(`[Debounce] Job ativo para ${userPhone}, mensagem será processada no próximo ciclo`);
                return;
            }
        }
    } catch (err) {
        // Job pode não existir, tudo bem
        console.log(`[Debounce] Nenhum job anterior encontrado para ${userPhone}`);
    }

    // Criar novo job com delay (debounce)
    await debounceQueue.add('process-buffered', { userPhone }, {
        jobId,
        delay: DEBOUNCE_DELAY_MS,
    });

    console.log(`[Debounce] Timer de ${DEBOUNCE_DELAY_MS}ms iniciado para ${userPhone}`);
}

// ==================== Worker ====================

/**
 * Worker que processa mensagens acumuladas após o debounce expirar.
 * Lê o buffer Redis, concatena as mensagens e as envia para o agente AI.
 */
export function startDebounceWorker(): Worker {
    const worker = new Worker('message-debounce', async (job: Job) => {
        const { userPhone } = job.data;
        const bufferKey = `${BUFFER_KEY_PREFIX}${userPhone}`;
        const metaKey = `${META_KEY_PREFIX}${userPhone}`;

        console.log(`[Debounce] Timer expirou para ${userPhone}. Processando mensagens acumuladas...`);

        // 1. Ler todas as mensagens do buffer
        const rawMessages = await redis.lrange(bufferKey, 0, -1);

        if (!rawMessages || rawMessages.length === 0) {
            console.log(`[Debounce] Buffer vazio para ${userPhone}, nada a processar.`);
            return;
        }

        // 2. Ler metadados
        const metaRaw = await redis.get(metaKey);
        if (!metaRaw) {
            console.error(`[Debounce] Metadados não encontrados para ${userPhone}. Abortando.`);
            return;
        }

        const metadata: DebounceMetadata = JSON.parse(metaRaw);

        // 3. Limpar buffer e meta ANTES de processar (evita duplicação se outra msg chegar)
        await redis.del(bufferKey);
        await redis.del(metaKey);

        // 4. Concatenar mensagens
        // Tentamos preservar multimodal como texto para simplificar
        const combinedMessages: string[] = rawMessages.map(raw => {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    // Multimodal — extrair textos
                    return parsed.map((item: any) => item.text || '[media]').join(' ');
                }
                return raw;
            } catch {
                // É uma string simples
                return raw;
            }
        });

        const combinedMessage = combinedMessages.join('\n');
        console.log(`[Debounce] Processando ${rawMessages.length} mensagem(ns) combinada(s) para ${userPhone}: "${combinedMessage.substring(0, 100)}..."`);

        // 5. Determinar Estado do Usuário (Routing Logic) — movido do webhook
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
            console.log(`[Debounce] Novo usuário detectado (${userPhone}). Criando registro...`);
            try {
                const createResult = await createUser({ telefone: userPhone, nome_completo: metadata.pushName || 'Desconhecido' });
                const parsedResult = JSON.parse(createResult);
                if (parsedResult.status === 'error') {
                    console.error(`[Debounce] Falha ao criar usuário: ${parsedResult.message}`);
                } else {
                    await updateUser({ telefone: userPhone, situacao: 'nao_respondido' });
                }
            } catch (createError) {
                console.error(`[Debounce] Exceção crítica ao criar usuário:`, createError);
            }
            userState = 'lead';
        } else {
            const currentName = user.nome_completo as string;
            const shouldUpdateName = metadata.pushName && (!currentName || currentName === 'Desconhecido' || currentName.trim() === '');
            if (shouldUpdateName) {
                await updateUser({ telefone: userPhone, nome_completo: metadata.pushName });
                user.nome_completo = metadata.pushName;
            } else {
                await updateUser({ telefone: userPhone });
            }

            if (user.situacao === 'cliente') { userState = 'customer'; }
            else if (user.qualificacao) { userState = 'qualified'; }
            else { userState = 'lead'; }
        }

        // 5.5 Verificar Override de Roteamento
        const routingOverride = await getAgentRouting(userPhone);
        if (routingOverride === 'vendedor') {
            console.log(`[Debounce] Override ativo: Redirecionando para Vendas.`);
            userState = 'qualified';
        }

        // 6. Construir contexto
        const history = await getChatHistory(userPhone);
        const context: AgentContext = {
            userId: metadata.sender,
            userName: metadata.pushName,
            userPhone: userPhone,
            history: history,
        };

        let responseText = '';

        try {
            // 7. Despachar para o Agente Correto
            switch (userState) {
                case 'qualified':
                    console.log(`[Debounce] Direcionando para VENDEDOR (Icaro)`);
                    responseText = await runVendedorAgent(combinedMessage, context);
                    break;
                case 'customer':
                    console.log(`[Debounce] Direcionando para ATENDENTE (Apolo Customer)`);
                    responseText = await runAtendenteAgent(combinedMessage, context);
                    break;
                case 'lead':
                default:
                    console.log(`[Debounce] Direcionando para APOLO (SDR)`);
                    responseText = await runApoloAgent(combinedMessage, context);
                    break;
            }

            // 8. Salvar resposta e Enviar via BullMQ
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

                await enqueueMessages({
                    phone: metadata.sender,
                    messages: segments,
                    context: 'agent-response',
                });
            }
        } catch (routingError) {
            console.error(`[Debounce] Exceção na LLM ou Roteamento do cliente ${userPhone}:`, routingError);

            try {
                await enqueueMessages({
                    phone: metadata.sender,
                    messages: [{ content: 'Tivemos uma instabilidade rápida no sistema. Nossa equipe já foi notificada. Um atendente humano responderá em breve.', type: 'text', delay: 0 }],
                    context: 'fallback-error'
                });
                await updateUser({ telefone: userPhone, observacoes: '[FALHA DE SISTEMA] Erro na requisição do bot, encaminhado para humano' });
            } catch (fallbackErr) {
                console.error('[Debounce] Falha crítica ao tentar enviar mensagem de fallback', fallbackErr);
            }
        }

        console.log(`[Debounce] ✅ Processamento concluído para ${userPhone} (${rawMessages.length} mensagem(ns))`);
    }, {
        connection: redis as any,
        concurrency: 5,
    });

    worker.on('completed', (job) => {
        console.log(`[Debounce] Job ${job.id} concluído`);
    });

    worker.on('failed', (job, err) => {
        console.error(`[Debounce] Job ${job?.id} falhou:`, err.message);
    });

    return worker;
}
