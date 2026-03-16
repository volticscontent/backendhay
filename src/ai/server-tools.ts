import pool from '../lib/db';
import { query, withClient } from '../lib/db';
import redis from '../lib/redis';
import { cosineSimilarity, toWhatsAppJid } from '../lib/utils';
import { evolutionFindMessages, evolutionSendMediaMessage, evolutionSendTextMessage } from '../lib/evolution';
import { generateEmbedding } from './embedding';
import { consultarServico } from '../lib/serpro';
import { saveConsultation } from '../lib/serpro-db';
import logger from '../lib/logger';

const log = logger.child('ServerTools');

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function extractMessageText(raw: unknown): string | null {
    if (!isObject(raw)) return null;
    if (typeof raw.conversation === 'string' && raw.conversation.trim()) return raw.conversation;
    if (isObject(raw.extendedTextMessage) && typeof raw.extendedTextMessage.text === 'string') return raw.extendedTextMessage.text;
    if (isObject(raw.imageMessage)) return (typeof raw.imageMessage.caption === 'string' && raw.imageMessage.caption.trim()) ? raw.imageMessage.caption : '[imagem]';
    if (isObject(raw.documentMessage)) return (typeof raw.documentMessage.caption === 'string') ? raw.documentMessage.caption : '[documento]';
    if (isObject(raw.audioMessage)) return '[audio]';
    if (isObject(raw.videoMessage)) return '[video]';
    if (isObject(raw.stickerMessage)) return '[sticker]';
    return null;
}

function parseDateStr(dateStr: string): Date | null {
    const parts = dateStr.split(' ');
    if (parts.length !== 2) return null;
    const [datePart, timePart] = parts;
    const dateSplit = datePart.split('/');
    const timeSplit = timePart.split(':');
    if (dateSplit.length !== 3 || timeSplit.length !== 2) return null;
    const d = new Date(parseInt(dateSplit[2]), parseInt(dateSplit[1]) - 1, parseInt(dateSplit[0]), parseInt(timeSplit[0]), parseInt(timeSplit[1]));
    return isNaN(d.getTime()) ? null : d;
}

// ==================== CRUD ====================

export async function getUser(phone: string): Promise<string> {
    try {
        const res = await query('SELECT * FROM leads WHERE telefone = $1 LIMIT 1', [phone]);
        if (res.rows.length === 0) return JSON.stringify({ status: 'not_found' });
        return JSON.stringify(res.rows[0]);
    } catch (error) {
        log.error('getUser error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

export async function createUser(data: Record<string, unknown>): Promise<string> {
    try {
        const { nome_completo, telefone } = data;
        const email = data.email || null;
        const res = await query(
            `INSERT INTO leads (nome_completo, telefone, email, data_cadastro) VALUES ($1, $2, $3, NOW()) RETURNING *`,
            [nome_completo, telefone, email]
        );
        log.info(`[createUser] Success: ${telefone}`, { result: res.rows[0] });
        return JSON.stringify({ status: 'success', id: res.rows[0].id, result: res.rows[0] });
    } catch (error) {
        log.error('createUser error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

export async function updateUser(data: Record<string, unknown>): Promise<string> {
    try {
        const { telefone, ...fields } = data;
        if (!telefone) return JSON.stringify({ status: 'error', message: 'Telefone is required' });

        const resId = await query('SELECT id FROM leads WHERE telefone = $1 LIMIT 1', [telefone]);
        if (resId.rows.length === 0) return JSON.stringify({ status: 'not_found', message: 'Usuário não encontrado' });
        const leadId = resId.rows[0].id;

        let updatedData = {};

        const tableMappings: Record<string, string[]> = {
            leads: ['nome_completo', 'email', 'cpf', 'data_nascimento', 'nome_mae', 'senha_gov'],
            leads_empresarial: ['cnpj', 'razao_social', 'nome_fantasia', 'tipo_negocio', 'faturamento_mensal', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep', 'cartao_cnpj'],
            leads_qualificacao: ['situacao', 'qualificacao', 'motivo_qualificacao', 'interesse_ajuda', 'pos_qualificacao', 'possui_socio', 'confirmacao_qualificacao'],
            leads_financeiro: ['tem_divida', 'tipo_divida', 'valor_divida_municipal', 'valor_divida_estadual', 'valor_divida_federal', 'valor_divida_ativa', 'tempo_divida', 'calculo_parcelamento'],
            leads_vendas: ['servico_negociado', 'status_atendimento', 'data_reuniao', 'procuracao', 'procuracao_ativa', 'procuracao_validade', 'servico_escolhido', 'reuniao_agendada', 'vendido'],
            leads_atendimento: ['atendente_id', 'envio_disparo', 'observacoes']
        };

        for (const [tableName, validFields] of Object.entries(tableMappings)) {
            const updateFields: string[] = [];
            const values: unknown[] = [];
            let i = 1;

            if (tableName === 'leads') {
                for (const field of validFields) {
                    if (fields[field] !== undefined) {
                        updateFields.push(`${field} = $${i}`);
                        values.push(fields[field]);
                        i++;
                    }
                }
                if (updateFields.length > 0) {
                    values.push(telefone);
                    const updateRes = await query(`UPDATE leads SET ${updateFields.join(', ')}, atualizado_em = NOW() WHERE telefone = $${i} RETURNING *`, values);
                    if (updateRes.rows.length > 0) {
                        updatedData = { ...updatedData, ...updateRes.rows[0] };
                    }
                }
            } else {
                for (const field of validFields) {
                    if (fields[field] !== undefined) {
                        if (tableName === 'leads_atendimento' && field === 'observacoes') {
                            updateFields.push(`${field} = CASE WHEN ${field} IS NULL OR ${field} = '' THEN $${i} ELSE ${field} || E'\\n' || $${i} END`);
                        } else {
                            updateFields.push(`${field} = $${i}`);
                        }
                        values.push(fields[field]);
                        i++;
                    }
                }

                if (tableName === 'leads_atendimento' && fields.situacao !== undefined) {
                    updateFields.push(`data_controle_24h = NOW()`);
                }

                if (updateFields.length > 0) {
                    const check = await query(`SELECT id FROM ${tableName} WHERE lead_id = $1`, [leadId]);
                    if (check.rows.length > 0) {
                        values.push(leadId);
                        await query(`UPDATE ${tableName} SET ${updateFields.join(', ')}, updated_at = NOW() WHERE lead_id = $${i}`, values);
                        updatedData = { ...updatedData, ...fields };
                    } else {
                        const insertCols = ['lead_id'];
                        const insertVals: unknown[] = [leadId];
                        const insertPlaceholders = ['$1'];

                        let paramIdx = 2;
                        for (const field of validFields) {
                            if (fields[field] !== undefined) {
                                insertCols.push(field);
                                insertVals.push(fields[field]);
                                insertPlaceholders.push(`$${paramIdx}`);
                                paramIdx++;
                            }
                        }

                        if (tableName === 'leads_atendimento' && fields.situacao !== undefined) {
                            insertCols.push('data_controle_24h');
                            insertVals.push(new Date());
                            insertPlaceholders.push(`$${paramIdx}`);
                            paramIdx++;
                        }
                        await query(`INSERT INTO ${tableName} (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`, insertVals);
                        updatedData = { ...updatedData, ...fields };
                    }
                }
            }
        }

        log.info(`[updateUser] Success: ${telefone}`);
        return JSON.stringify({ status: 'success', message: 'User updated', result: updatedData });
    } catch (error) {
        log.error('updateUser error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

// ==================== Routing ====================

export async function setAgentRouting(phone: string, agent: string | null): Promise<string> {
    const redisKey = `routing_override:${phone}`;
    try {
        if (agent) {
            await redis.set(redisKey, agent, 'EX', 86400);
            return JSON.stringify({ status: 'success', message: `Routing override set to ${agent}` });
        } else {
            await redis.del(redisKey);
            return JSON.stringify({ status: 'success', message: 'Routing override cleared' });
        }
    } catch (error) {
        log.error('setAgentRouting error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

export async function getAgentRouting(phone: string): Promise<string | null> {
    try {
        return await redis.get(`routing_override:${phone}`);
    } catch (error) {
        log.error('getAgentRouting error:', error);
        return null;
    }
}

// ==================== Scheduling ====================

export async function checkAvailability(dateStr: string): Promise<string> {
    try {
        if (!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(dateStr)) {
            return JSON.stringify({ available: false, message: 'Formato de data inválido. Use dd/MM/yyyy HH:mm' });
        }
        const parsedDate = parseDateStr(dateStr);
        if (!parsedDate) return JSON.stringify({ available: false, message: 'Data inválida.' });
        const res = await query(
            `SELECT l.nome_completo FROM leads l JOIN leads_vendas lv ON l.id = lv.lead_id WHERE lv.data_reuniao = $1`,
            [parsedDate]
        );
        return JSON.stringify({ available: res.rows.length === 0, message: res.rows.length > 0 ? 'Horário indisponível.' : 'Horário disponível.' });
    } catch (error) {
        log.error('checkAvailability error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

export async function scheduleMeeting(phone: string, dateStr: string): Promise<string> {
    try {
        const userRes = await query('SELECT id FROM leads WHERE telefone = $1', [phone]);
        if (userRes.rows.length === 0) return JSON.stringify({ status: 'error', message: 'Usuário não encontrado.' });
        const leadId = userRes.rows[0].id;
        await query(`INSERT INTO leads_vendas (lead_id) VALUES ($1) ON CONFLICT (lead_id) DO NOTHING`, [leadId]);
        const parsedDate = parseDateStr(dateStr);
        if (!parsedDate) return JSON.stringify({ status: 'error', message: 'Data inválida.' });
        await query(`UPDATE leads_vendas SET data_reuniao = $1 WHERE lead_id = $2`, [parsedDate, leadId]);
        return JSON.stringify({ status: 'success', message: `Reunião agendada para ${dateStr}` });
    } catch (error) {
        log.error('scheduleMeeting error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

export async function tryScheduleMeeting(phone: string, dateStr: string): Promise<string> {
    const avail = await checkAvailability(dateStr);
    const availJson = JSON.parse(avail);
    if (availJson.available) return await scheduleMeeting(phone, dateStr);
    return JSON.stringify({ status: 'unavailable', message: availJson.message || 'Horário indisponível.' });
}

// ==================== Formulários e Listas ====================

export async function sendForm(phone: string, observacao: string): Promise<string> {
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://haylanderform.vercel.app';
    if (baseUrl.includes('loca.lt') || baseUrl.includes('ngrok-free.app')) {
        baseUrl = 'https://haylanderform.vercel.app';
    }
    baseUrl = baseUrl.replace(/\/$/, '');
    const link = `${baseUrl}/${phone}`;
    await updateUser({ telefone: phone, observacoes: `Interesse: ${observacao}` });
    return JSON.stringify({ link, message: `Formulário gerado com sucesso. O link é: ${link}. Envie este link EXATO para o cliente.` });
}

export async function sendMeetingForm(phone: string): Promise<string> {
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://haylanderform.vercel.app';
    if (baseUrl.includes('loca.lt') || baseUrl.includes('ngrok-free.app')) {
        baseUrl = 'https://haylanderform.vercel.app';
    }
    baseUrl = baseUrl.replace(/\/$/, '');
    const link = `${baseUrl}/reuniao/${phone}`;
    return JSON.stringify({ link, message: `Link de agendamento gerado: ${link}. Envie ao cliente.` });
}

export async function sendEnumeratedList(phone: string): Promise<string> {
    const listText = `Olá! 👋 Como posso te ajudar? Escolha uma opção:\n\n1️⃣ Regularização MEI\n2️⃣ Abertura de MEI\n3️⃣ Falar com atendente\n4️⃣ Informações sobre os serviços\n5️⃣ Sair do atendimento`;
    try {
        const jid = toWhatsAppJid(phone);
        const evoLog = await evolutionSendTextMessage(jid, listText);
        log.info(`[sendEnumeratedList] Evolution response for ${phone}:`, { evolution_log: evoLog });

        // Registrar no histórico para manter contexto entre agente e cliente
        const { addToHistory } = await import('../lib/chat-history');
        await addToHistory(phone, 'assistant', listText);

        // Notificar socket para o painel admin ver a mensagem
        // 3) Emitir mensagem WebSocket para atualizar a UI do atendente em tempo real
        const { notifySocketServer } = await import('../lib/socket');
        notifySocketServer('haylander-chat-updates', {
            chatId: jid,
            fromMe: true, // O bot enviou
            message: { conversation: listText },
            id: `msg-${Date.now()}`,
            messageTimestamp: Math.floor(Date.now() / 1000)
        }).catch(err => log.error('Erro ao notificar via Socket.io Server', err));

        return JSON.stringify({ status: 'success', message: 'Lista enviada ao cliente com sucesso.', evolution_log: evoLog });
    } catch (error) {
        log.error('sendEnumeratedList error:', error);
        return JSON.stringify({ status: 'error', message: `Falha ao enviar lista: ${String(error)}` });
    }
}

// ==================== Atendente ====================

export async function callAttendant(phone: string, reason: string = 'Solicitação do cliente'): Promise<string> {
    try {
        await query(`UPDATE leads SET needs_attendant = true, attendant_requested_at = NOW() WHERE telefone = $1`, [phone]);
        await redis.set(`attendant_requested:${phone}`, reason, 'EX', 86400); // 24h

        // Notificar via WebSocket para o painel (ChatInterface/Frontend) atualizar realtime
        try {
            const { notifySocketServer } = await import('../lib/socket');
            await notifySocketServer('haylander-chat-updates', {
                type: 'attendant-requested',
                phone: phone,
                reason: reason
            });
        } catch (socketErr) {
            log.warn('Erro ao notificar socket sobre request de atendente:', socketErr);
        }

        const attendantNumber = process.env.ATTENDANT_PHONE;

        if (attendantNumber) {
            const text = `🔔 *Solicitação de Atendimento*\n\nCliente *${phone}* solicitou atendente.\n📝 *Motivo:* ${reason}\n🔗 https://wa.me/${phone.replace(/\D/g, '')}`;
            const evoLog = await evolutionSendTextMessage(toWhatsAppJid(attendantNumber), text);
            log.info(`[callAttendant] Evolution response for notifying attendant (${attendantNumber}):`, { evolution_log: evoLog });
            return JSON.stringify({ status: 'success', message: 'Atendente notificado. Aguarde um momento.', evolution_log: evoLog });
        }

        log.warn('Atenção: Atendente solicitado, mas ATTENDANT_PHONE não está configurado no .env.');
        return JSON.stringify({ status: 'success', message: 'Solicitação registrada. Aguarde um momento.' });
    } catch (error) {
        log.error('callAttendant error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

// ==================== Context & Services ====================

export async function contextRetrieve(phone: string, limit: number = 30): Promise<string> {
    try {
        const jid = toWhatsAppJid(phone);
        const data = await evolutionFindMessages(jid, limit);
        const records = data?.messages?.records;
        if (!Array.isArray(records)) return '[]';
        const messages = records.map((m) => {
            const text = extractMessageText(m.message);
            if (!text) return null;
            return `[${m.key.fromMe ? 'Bot' : 'User'}] ${text}`;
        }).filter(Boolean).reverse();
        return JSON.stringify(messages);
    } catch (error) {
        log.error('contextRetrieve error:', error);
        return '[]';
    }
}

export async function searchServices(searchQuery: string): Promise<string> {
    try {
        const res = await query('SELECT nome as name, descricao as description, price_info FROM services WHERE active = true AND nome ILIKE $1', [`%${searchQuery}%`]);
        if (res.rows.length > 0) return JSON.stringify(res.rows);
        const all = await query('SELECT nome as name, descricao as description, price_info FROM services WHERE active = true');
        return JSON.stringify(all.rows);
    } catch (error) {
        log.error('searchServices error:', error);
        return '[]';
    }
}

// ==================== Mídia ====================

export async function getAvailableMedia(): Promise<string> {
    const defaults = [
        { key: 'apc', description: 'Apresentação Comercial (PDF)', type: 'document' },
        { key: 'video_institucional', description: 'Vídeo Institucional', type: 'video' }
    ];
    try {
        const { listFilesFromR2 } = await import('../lib/r2');
        const files = await listFilesFromR2();
        const validExts = ['.pdf', '.mp4', '.jpg', '.jpeg', '.png'];
        const mediaFiles = files
            .filter((f: any) => validExts.some(ext => f.key.toLowerCase().endsWith(ext)) && !f.key.includes('private'))
            .map((f: any) => ({
                key: f.key,
                description: f.key.split('/').pop()?.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '') || f.key,
                type: f.key.endsWith('.mp4') ? 'video' : f.key.endsWith('.pdf') ? 'document' : 'image',
                url: f.url,
            }));
        return JSON.stringify([...defaults, ...mediaFiles]);
    } catch {
        return JSON.stringify(defaults);
    }
}

export async function sendMedia(phone: string, keyOrUrl: string): Promise<string> {
    if (keyOrUrl === 'apc') return sendCommercialPresentation(phone, 'apc');
    if (keyOrUrl === 'video_institucional' || keyOrUrl === 'video' || keyOrUrl === 'video-tutorial-procuracao-ecac') return sendCommercialPresentation(phone, 'video');

    let mediaUrl = keyOrUrl;
    const fileName = keyOrUrl.split('/').pop() || 'arquivo';

    if (!keyOrUrl.startsWith('http')) {
        const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
        if (R2_PUBLIC_URL) {
            mediaUrl = `${R2_PUBLIC_URL.replace(/\/$/, '')}/${keyOrUrl}`;
        } else {
            return JSON.stringify({ status: 'error', message: 'URL base do R2 não configurada.' });
        }
    }

    const ext = mediaUrl.split('.').pop()?.toLowerCase();
    let mediaType: 'image' | 'video' | 'audio' | 'document' = 'document';
    let mimetype = 'application/octet-stream';

    if (['mp4', 'mov', 'avi'].includes(ext || '')) { mediaType = 'video'; mimetype = 'video/mp4'; }
    else if (['jpg', 'jpeg', 'png', 'gif'].includes(ext || '')) { mediaType = 'image'; mimetype = 'image/jpeg'; }
    else if (['mp3', 'ogg', 'wav'].includes(ext || '')) { mediaType = 'audio'; mimetype = 'audio/mpeg'; }
    else if (ext === 'pdf') { mediaType = 'document'; mimetype = 'application/pdf'; }

    try {
        const evoLog = await evolutionSendMediaMessage(toWhatsAppJid(phone), mediaUrl, mediaType, fileName, fileName, mimetype);
        log.info(`[sendMedia] Evolution response for ${phone}:`, { evolution_log: evoLog });
        
        try {
            const { notifySocketServer } = await import('../lib/socket');
            notifySocketServer('haylander-chat-updates', {
                chatId: toWhatsAppJid(phone),
                fromMe: true,
                message: { conversation: `[Midia enviada: ${fileName}]` },
                id: `msg-${Date.now()}`,
                messageTimestamp: Math.floor(Date.now() / 1000)
            }).catch(() => {});
        } catch (e) {}

        return JSON.stringify({ status: 'sent', message: `Arquivo ${fileName} enviado.`, evolution_log: evoLog });
    } catch (error) {
        log.error(`sendMedia error ${keyOrUrl}:`, error);
        return JSON.stringify({ status: 'error', message: `Erro ao enviar arquivo: ${String(error)}` });
    }
}

export async function sendCommercialPresentation(phone: string, type: 'apc' | 'video' = 'apc'): Promise<string> {
    const jid = toWhatsAppJid(phone);
    const defaultApc = 'https://pub-9bcc48f0ec304eabbad08c9e3dec23de.r2.dev/apc%20haylander.pdf';
    const defaultVideo = 'https://pub-9bcc48f0ec304eabbad08c9e3dec23de.r2.dev/0915.mp4';
    let mediaUrl = type === 'apc' ? defaultApc : defaultVideo;

    try {
        const settingKey = type === 'apc' ? 'apresentacao_comercial' : 'video_ecac';
        const res = await pool.query('SELECT value FROM system_settings WHERE key = $1', [settingKey]);
        if (res.rows.length > 0 && res.rows[0].value) mediaUrl = res.rows[0].value;
    } catch { /* usa default */ }

    try {
        if (type === 'apc') {
            const evoLog = await evolutionSendMediaMessage(jid, mediaUrl, 'document', 'Apresentação Comercial Haylander', 'Apresentacao_Haylander.pdf', 'application/pdf');
            log.info(`[sendCommercialPresentation] Evolution response (APC) for ${phone}:`, { evolution_log: evoLog });
            
            try {
                const { notifySocketServer } = await import('../lib/socket');
                notifySocketServer('haylander-chat-updates', {
                    chatId: jid,
                    fromMe: true,
                    message: { conversation: `[Apresentação Comercial enviada]` },
                    id: `msg-${Date.now()}`,
                    messageTimestamp: Math.floor(Date.now() / 1000)
                }).catch(() => {});
            } catch (e) {}

            return JSON.stringify({ status: 'sent', message: 'Apresentação comercial enviada (PDF).', type, evolution_log: evoLog });
        } else {
            const evoLog = await evolutionSendMediaMessage(jid, mediaUrl, 'video', 'Vídeo Tutorial', 'tutorial.mp4', 'video/mp4');
            log.info(`[sendCommercialPresentation] Evolution response (Video) for ${phone}:`, { evolution_log: evoLog });
            
            try {
                const { notifySocketServer } = await import('../lib/socket');
                notifySocketServer('haylander-chat-updates', {
                    chatId: jid,
                    fromMe: true,
                    message: { conversation: `[Vídeo Tutorial enviado]` },
                    id: `msg-${Date.now()}`,
                    messageTimestamp: Math.floor(Date.now() / 1000)
                }).catch(() => {});
            } catch (e) {}

            return JSON.stringify({ status: 'sent', message: 'Vídeo tutorial enviado.', type, evolution_log: evoLog });
        }
    } catch (error) {
        log.error(`sendCommercialPresentation error ${type}:`, error);
        return JSON.stringify({ status: 'error', message: `Erro ao enviar ${type}: ${String(error)}` });
    }
}

// ==================== Serpro ====================

export async function checkCnpjSerpro(cnpj: string, service: 'CCMEI_DADOS' | 'SIT_FISCAL' = 'CCMEI_DADOS'): Promise<string> {
    try {
        const result = await consultarServico(service, cnpj);
        saveConsultation(cnpj, service, result, 200).catch(err =>
            log.error('[checkCnpjSerpro] Error saving:', err)
        );
        return JSON.stringify(result);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ status: 'error', message: errorMessage });
    }
}

// ==================== Interpreter (Memory) ====================

export async function interpreter(
    phone: string,
    action: 'post' | 'get',
    text: string,
    category: 'qualificacao' | 'vendas' | 'atendimento' = 'atendimento'
): Promise<string> {
    const redisKey = `interpreter_memory:${phone}`;

    try {

        if (action === 'post') {
            const truncatedText = text.substring(0, 1000);
            const embedding = await generateEmbedding(truncatedText);

            try {
                const memoryObj = { content: truncatedText, category, embedding: embedding || [], created_at: new Date().toISOString() };
                await redis.lpush(redisKey, JSON.stringify(memoryObj));
                await redis.ltrim(redisKey, 0, 49);
            } catch (err) {
                log.error('Redis write error:', err);
            }

            if (embedding && embedding.length > 0) {
                try {
                    await query(
                        `INSERT INTO interpreter_memories (phone, content, category, embedding) VALUES ($1, $2, $3, $4::vector)`,
                        [phone, truncatedText, category, JSON.stringify(embedding)]
                    );
                } catch {
                    await query(
                        `INSERT INTO interpreter_memories (phone, content, category) VALUES ($1, $2, $3)`,
                        [phone, truncatedText, category]
                    );
                }
            } else {
                await query(
                    `INSERT INTO interpreter_memories (phone, content, category) VALUES ($1, $2, $3)`,
                    [phone, truncatedText, category]
                );
            }
            return JSON.stringify({ status: 'stored', message: 'Memória armazenada com sucesso.' });
        } else {
            // GET
            const embedding = await generateEmbedding(text);

            interface InterpreterMemory {
                content: string;
                category: string;
                embedding?: number[];
                created_at: string;
                similarity?: number;
            }

            let rows: InterpreterMemory[] = [];

            try {
                const rawMemories = await redis.lrange(redisKey, 0, -1);
                if (rawMemories.length > 0) {
                    const memories = rawMemories.map(m => JSON.parse(m) as InterpreterMemory);
                    if (embedding && embedding.length > 0) {
                        const scored = memories.map(m => ({ ...m, similarity: (m.embedding && m.embedding.length > 0) ? cosineSimilarity(embedding, m.embedding) : 0 }));
                        scored.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
                        rows = scored.slice(0, 5);
                    } else {
                        rows = memories.slice(0, 5);
                    }
                }
            } catch (err) {
                log.error('Redis read error:', err);
            }

            if (rows.length === 0) {
                if (embedding && embedding.length > 0) {
                    try {
                        const res = await query(`
              SELECT content, category, created_at, 1 - (embedding <=> $1::vector) as similarity
              FROM interpreter_memories WHERE phone = $2 ORDER BY similarity DESC LIMIT 5
            `, [JSON.stringify(embedding), phone]);
                        rows = res.rows as unknown as InterpreterMemory[];
                    } catch {
                        const res = await query(`
              SELECT content, category, created_at FROM interpreter_memories
              WHERE phone = $1 AND content ILIKE $2 ORDER BY created_at DESC LIMIT 5
            `, [phone, `%${text}%`]);
                        rows = res.rows as unknown as InterpreterMemory[];
                    }
                } else {
                    const res = await query(`
            SELECT content, category, created_at FROM interpreter_memories
            WHERE phone = $1 ORDER BY created_at DESC LIMIT 5
          `, [phone]);
                    rows = res.rows as unknown as InterpreterMemory[];
                }
            }

            if (rows.length === 0) {
                return JSON.stringify({ status: 'no_results', message: 'Nenhuma memória relevante encontrada.' });
            }

            const memories = rows.map(r => {
                const date = new Date(r.created_at).toLocaleString('pt-BR');
                return `[${date}] [${r.category}] ${r.content}`;
            }).join('\n');

            return JSON.stringify({ status: 'success', memories });
        }
    } catch (error) {
        log.error('Interpreter error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

// ==================== Tracking ====================

export async function trackResourceDelivery(
    leadId: number,
    resourceType: string,
    resourceKey: string,
    metadata?: Record<string, unknown>
): Promise<void> {
    try {
        await query(`
      INSERT INTO resource_tracking (lead_id, resource_type, resource_key, delivered_at, status, metadata)
      VALUES ($1, $2, $3, NOW(), 'delivered', $4)
    `, [leadId, resourceType, resourceKey, JSON.stringify(metadata || {})]);
    } catch (error) {
        log.error('trackResourceDelivery error:', error);
    }
}

export async function checkProcuracaoStatus(leadId: number): Promise<boolean> {
    try {
        const result = await query(`
      SELECT status FROM resource_tracking
      WHERE lead_id = $1 AND resource_type = 'video-tutorial' AND resource_key = 'video-tutorial-procuracao-ecac'
      ORDER BY delivered_at DESC LIMIT 1
    `, [leadId]);
        return result.rows.length > 0 && result.rows[0].status === 'completed';
    } catch (error) {
        log.error('checkProcuracaoStatus error:', error);
        return false;
    }
}

export async function markProcuracaoCompleted(leadId: number): Promise<void> {
    try {
        await query(`
      UPDATE resource_tracking SET status = 'completed', accessed_at = NOW()
      WHERE lead_id = $1 AND resource_type = 'video-tutorial' AND resource_key = 'video-tutorial-procuracao-ecac'
    `, [leadId]);
    } catch (error) {
        log.error('markProcuracaoCompleted error:', error);
    }
}

// ==================== Message Segments ====================

export interface MessageSegment {
    id: string;
    content: string;
    type: 'text' | 'media' | 'link';
    delay?: number;
    metadata?: Record<string, unknown>;
}

export async function sendMessageSegment(phone: string, segment: MessageSegment): Promise<void> {
    try {
        switch (segment.type) {
            case 'text':
                await evolutionSendTextMessage(toWhatsAppJid(phone), segment.content);
                break;
            case 'link':
                await evolutionSendTextMessage(toWhatsAppJid(phone), segment.content);
                if (segment.metadata?.url) await evolutionSendTextMessage(toWhatsAppJid(phone), String(segment.metadata.url));
                break;
            case 'media':
                if (segment.metadata?.mediaKey) await sendMedia(phone, String(segment.metadata.mediaKey));
                break;
        }

        try {
            const { notifySocketServer } = await import('../lib/socket');
            let contentText = segment.content;
            if (segment.type === 'link' && segment.metadata?.url) contentText += '\n' + segment.metadata.url;
            
        );
        return JSON.stringify(result);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ status: 'error', message: errorMessage });
    }
}

// ==================== Interpreter (Memory) ====================

export async function interpreter(
    phone: string,
    action: 'post' | 'get',
    text: string,
    category: 'qualificacao' | 'vendas' | 'atendimento' = 'atendimento'
): Promise<string> {
    const redisKey = `interpreter_memory:${phone}`;

    try {

        if (action === 'post') {
            const truncatedText = text.substring(0, 1000);
            const embedding = await generateEmbedding(truncatedText);

            try {
                const memoryObj = { content: truncatedText, category, embedding: embedding || [], created_at: new Date().toISOString() };
                await redis.lpush(redisKey, JSON.stringify(memoryObj));
                await redis.ltrim(redisKey, 0, 49);
            } catch (err) {
                log.error('Redis write error:', err);
            }

            if (embedding && embedding.length > 0) {
                try {
                    await query(
                        `INSERT INTO interpreter_memories (phone, content, category, embedding) VALUES ($1, $2, $3, $4::vector)`,
                        [phone, truncatedText, category, JSON.stringify(embedding)]
                    );
                } catch {
                    await query(
                        `INSERT INTO interpreter_memories (phone, content, category) VALUES ($1, $2, $3)`,
                        [phone, truncatedText, category]
                    );
                }
            } else {
                await query(
                    `INSERT INTO interpreter_memories (phone, content, category) VALUES ($1, $2, $3)`,
                    [phone, truncatedText, category]
                );
            }
            return JSON.stringify({ status: 'stored', message: 'Memória armazenada com sucesso.' });
        } else {
            // GET
            const embedding = await generateEmbedding(text);

            interface InterpreterMemory {
                content: string;
                category: string;
                embedding?: number[];
                created_at: string;
                similarity?: number;
            }

            let rows: InterpreterMemory[] = [];

            try {
                const rawMemories = await redis.lrange(redisKey, 0, -1);
                if (rawMemories.length > 0) {
                    const memories = rawMemories.map(m => JSON.parse(m) as InterpreterMemory);
                    if (embedding && embedding.length > 0) {
                        const scored = memories.map(m => ({ ...m, similarity: (m.embedding && m.embedding.length > 0) ? cosineSimilarity(embedding, m.embedding) : 0 }));
                        scored.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
                        rows = scored.slice(0, 5);
                    } else {
                        rows = memories.slice(0, 5);
                    }
                }
            } catch (err) {
                log.error('Redis read error:', err);
            }

            if (rows.length === 0) {
                if (embedding && embedding.length > 0) {
                    try {
                        const res = await query(`
              SELECT content, category, created_at, 1 - (embedding <=> $1::vector) as similarity
              FROM interpreter_memories WHERE phone = $2 ORDER BY similarity DESC LIMIT 5
            `, [JSON.stringify(embedding), phone]);
                        rows = res.rows as unknown as InterpreterMemory[];
                    } catch {
                        const res = await query(`
              SELECT content, category, created_at FROM interpreter_memories
              WHERE phone = $1 AND content ILIKE $2 ORDER BY created_at DESC LIMIT 5
            `, [phone, `%${text}%`]);
                        rows = res.rows as unknown as InterpreterMemory[];
                    }
                } else {
                    const res = await query(`
            SELECT content, category, created_at FROM interpreter_memories
            WHERE phone = $1 ORDER BY created_at DESC LIMIT 5
          `, [phone]);
                    rows = res.rows as unknown as InterpreterMemory[];
                }
            }

            if (rows.length === 0) {
                return JSON.stringify({ status: 'no_results', message: 'Nenhuma memória relevante encontrada.' });
            }

            const memories = rows.map(r => {
                const date = new Date(r.created_at).toLocaleString('pt-BR');
                return `[${date}] [${r.category}] ${r.content}`;
            }).join('\n');

            return JSON.stringify({ status: 'success', memories });
        }
    } catch (error) {
        log.error('Interpreter error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

// ==================== Tracking ====================

export async function trackResourceDelivery(
    leadId: number,
    resourceType: string,
    resourceKey: string,
    metadata?: Record<string, unknown>
): Promise<void> {
    try {
        await query(`
      INSERT INTO resource_tracking (lead_id, resource_type, resource_key, delivered_at, status, metadata)
      VALUES ($1, $2, $3, NOW(), 'delivered', $4)
    `, [leadId, resourceType, resourceKey, JSON.stringify(metadata || {})]);
    } catch (error) {
        log.error('trackResourceDelivery error:', error);
    }
}

export async function checkProcuracaoStatus(leadId: number): Promise<boolean> {
    try {
        const result = await query(`
      SELECT status FROM resource_tracking
      WHERE lead_id = $1 AND resource_type = 'video-tutorial' AND resource_key = 'video-tutorial-procuracao-ecac'
      ORDER BY delivered_at DESC LIMIT 1
    `, [leadId]);
        return result.rows.length > 0 && result.rows[0].status === 'completed';
    } catch (error) {
        log.error('checkProcuracaoStatus error:', error);
        return false;
    }
}

export async function markProcuracaoCompleted(leadId: number): Promise<void> {
    try {
        await query(`
      UPDATE resource_tracking SET status = 'completed', accessed_at = NOW()
      WHERE lead_id = $1 AND resource_type = 'video-tutorial' AND resource_key = 'video-tutorial-procuracao-ecac'
    `, [leadId]);
    } catch (error) {
        log.error('markProcuracaoCompleted error:', error);
    }
}

// ==================== Message Segments ====================

export interface MessageSegment {
    id: string;
    content: string;
    type: 'text' | 'media' | 'link';
    delay?: number;
    metadata?: Record<string, unknown>;
}

export async function sendMessageSegment(phone: string, segment: MessageSegment): Promise<void> {
    try {
        switch (segment.type) {
            case 'text':
                await evolutionSendTextMessage(toWhatsAppJid(phone), segment.content);
                break;
            case 'link':
                await evolutionSendTextMessage(toWhatsAppJid(phone), segment.content);
                if (segment.metadata?.url) await evolutionSendTextMessage(toWhatsAppJid(phone), String(segment.metadata.url));
                break;
            case 'media':
                if (segment.metadata?.mediaKey) await sendMedia(phone, String(segment.metadata.mediaKey));
                break;
        }

        try {
            const { notifySocketServer } = await import('../lib/socket');
            let contentText = segment.content;
            if (segment.type === 'link' && segment.metadata?.url) contentText += '\n' + segment.metadata.url;
            
            notifySocketServer('haylander-chat-updates', {
                chatId: toWhatsAppJid(phone),
                fromMe: true,
                message: { conversation: segment.type === 'media' ? `[Midia enviada]` : contentText },
                id: `msg-${Date.now()}`,
                messageTimestamp: Math.floor(Date.now() / 1000)
            }).catch(() => {});
        } catch (e) {}

        log.info(`[MessageSegment] Sent: ${segment.id} to ${phone}`);
    } catch (error) {
        log.error(`[MessageSegment] Error sending ${segment.id}:`, error);
    }
}

export async function getUpdatableFields() {
    const tableMappings: Record<string, string[]> = {
        leads: ['nome_completo', 'email', 'cpf', 'data_nascimento', 'nome_mae', 'senha_gov'],
        leads_empresarial: ['cnpj', 'razao_social', 'nome_fantasia', 'tipo_negocio', 'faturamento_mensal', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep', 'cartao_cnpj'],
        leads_qualificacao: ['situacao', 'qualificacao', 'motivo_qualificacao', 'interesse_ajuda', 'pos_qualificacao', 'possui_socio', 'confirmacao_qualificacao'],
        leads_financeiro: ['tem_divida', 'tipo_divida', 'valor_divida_municipal', 'valor_divida_estadual', 'valor_divida_federal', 'valor_divida_ativa', 'tempo_divida', 'calculo_parcelamento'],
        leads_vendas: ['servico_negociado', 'status_atendimento', 'data_reuniao', 'procuracao', 'procuracao_ativa', 'procuracao_validade', 'servico_escolhido', 'reuniao_agendada', 'vendido'],
        leads_atendimento: ['atendente_id', 'envio_disparo', 'observacoes']
    };
    return JSON.stringify({
        instrucoes: "Para atualizar os dados do cliente centralmente, chame update_user enviando os campos desejados na raiz do JSON (ex: { situacao: 'qualificado', email: 'x@y.com' }). Use a tabela abaixo para saber EXATAMENTE como os campos se chamam no banco.",
        tabelas_e_campos: tableMappings
    }, null, 2);
}
