import pool from '../lib/db';
import { query, withClient } from '../lib/db';
import redis from '../lib/redis';
import { cosineSimilarity, toWhatsAppJid } from '../lib/utils';
import { evolutionFindMessages, evolutionSendMediaMessage, evolutionSendTextMessage } from '../lib/evolution';
import { generateEmbedding } from './embedding';
import { consultarServico } from '../lib/serpro';
import { saveConsultation } from '../lib/serpro-db';

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
        console.error('getUser error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

export async function createUser(data: Record<string, unknown>): Promise<string> {
    try {
        const { nome_completo, telefone } = data;
        const email = data.email || null;
        const res = await query(
            `INSERT INTO leads (nome_completo, telefone, email, data_cadastro) VALUES ($1, $2, $3, NOW()) RETURNING id`,
            [nome_completo, telefone, email]
        );
        return JSON.stringify({ status: 'success', id: res.rows[0].id });
    } catch (error) {
        console.error('createUser error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

export async function updateUser(data: Record<string, unknown>): Promise<string> {
    try {
        const { telefone, ...fields } = data;
        if (!telefone) return JSON.stringify({ status: 'error', message: 'Telefone is required' });

        const leadsFields = [
            'nome_completo', 'email', 'cpf', 'nome_mae', 'senha_gov', 'situacao', 'observacoes', 'qualificacao',
            'faturamento_mensal', 'tem_divida', 'tipo_negocio', 'possui_socio', 'valor_divida_federal',
            'valor_divida_ativa', 'valor_divida_estadual', 'valor_divida_municipal', 'cartao_cnpj',
            'tipo_divida', 'motivo_qualificacao', 'interesse_ajuda', 'pos_qualificacao', 'cnpj', 'razao_social'
        ];
        const updateFields: string[] = [];
        const values: unknown[] = [];
        let i = 1;

        for (const [key, value] of Object.entries(fields)) {
            if (leadsFields.includes(key)) {
                updateFields.push(`${key} = $${i}`);
                values.push(value);
                i++;
            }
        }

        if (updateFields.length > 0) {
            values.push(telefone);
            await query(`UPDATE leads SET ${updateFields.join(', ')} WHERE telefone = $${i}`, values);
        }

        const resId = await query('SELECT id FROM leads WHERE telefone = $1', [telefone]);
        if (resId.rows.length > 0) {
            const leadId = resId.rows[0].id;
            const check = await query('SELECT id FROM leads_atendimento WHERE lead_id = $1', [leadId]);
            if (check.rows.length > 0) {
                await query('UPDATE leads_atendimento SET data_controle_24h = NOW() WHERE lead_id = $1', [leadId]);
            } else {
                await query('INSERT INTO leads_atendimento (lead_id, data_controle_24h) VALUES ($1, NOW())', [leadId]);
            }
        }

        return JSON.stringify({ status: 'success', message: 'User updated' });
    } catch (error) {
        console.error('updateUser error:', error);
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
        console.error('setAgentRouting error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

export async function getAgentRouting(phone: string): Promise<string | null> {
    try {
        return await redis.get(`routing_override:${phone}`);
    } catch (error) {
        console.error('getAgentRouting error:', error);
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
        console.error('checkAvailability error:', error);
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
        console.error('scheduleMeeting error:', error);
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

export async function sendEnumeratedList(): Promise<string> {
    return JSON.stringify({
        message: `1. Regularização\n2. Abertura de MEI\n3. Falar com atendente\n4. Informações sobre os serviços\n5. Sair do atendimento`
    });
}

// ==================== Atendente ====================

export async function callAttendant(phone: string, reason: string = 'Solicitação do cliente'): Promise<string> {
    try {
        await query(`UPDATE leads SET needs_attendant = true, attendant_requested_at = NOW() WHERE telefone = $1`, [phone]);

        const attendantNumber = process.env.ATTENDANT_PHONE;
        const instanceId = process.env.EVOLUTION_INSTANCE_ID;
        const apiBaseUrl = process.env.EVOLUTION_API_URL;
        const apiKey = process.env.EVOLUTION_API_KEY;

        if (attendantNumber && instanceId && apiBaseUrl && apiKey) {
            const cleanBaseUrl = apiBaseUrl.replace(/\/$/, '');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            try {
                await fetch(`${cleanBaseUrl}/message/sendText/${instanceId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
                    body: JSON.stringify({
                        number: attendantNumber,
                        text: `🔔 *Solicitação de Atendimento*\n\nCliente *${phone}* solicitou atendente.\n📝 *Motivo:* ${reason}\n🔗 https://wa.me/${phone}`
                    }),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutId);
            }
            return JSON.stringify({ status: 'success', message: 'Atendente notificado. Aguarde um momento.' });
        }

        return JSON.stringify({ status: 'success', message: 'Solicitação registrada. Aguarde um momento.' });
    } catch (error) {
        console.error('callAttendant error:', error);
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
        console.error('contextRetrieve error:', error);
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
        console.error('searchServices error:', error);
        return '[]';
    }
}

// ==================== Mídia ====================

export async function getAvailableMedia(): Promise<string> {
    return JSON.stringify([
        { key: 'apc', description: 'Apresentação Comercial (PDF)', type: 'document' },
        { key: 'video_institucional', description: 'Vídeo Institucional', type: 'video' }
    ]);
}

export async function sendMedia(phone: string, keyOrUrl: string): Promise<string> {
    if (keyOrUrl === 'apc') return sendCommercialPresentation(phone, 'apc');
    if (keyOrUrl === 'video_institucional' || keyOrUrl === 'video') return sendCommercialPresentation(phone, 'video');

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
        await evolutionSendMediaMessage(toWhatsAppJid(phone), mediaUrl, mediaType, fileName, fileName, mimetype);
        return JSON.stringify({ status: 'sent', message: `Arquivo ${fileName} enviado.` });
    } catch (error) {
        console.error(`sendMedia error ${keyOrUrl}:`, error);
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
            await evolutionSendMediaMessage(jid, mediaUrl, 'document', 'Apresentação Comercial Haylander', 'Apresentacao_Haylander.pdf', 'application/pdf');
            return JSON.stringify({ status: 'sent', message: 'Apresentação comercial enviada (PDF).', type });
        } else {
            await evolutionSendMediaMessage(jid, mediaUrl, 'video', 'Vídeo Tutorial', 'tutorial.mp4', 'video/mp4');
            return JSON.stringify({ status: 'sent', message: 'Vídeo tutorial enviado.', type });
        }
    } catch (error) {
        console.error(`sendCommercialPresentation error ${type}:`, error);
        return JSON.stringify({ status: 'error', message: `Erro ao enviar ${type}: ${String(error)}` });
    }
}

// ==================== Serpro ====================

export async function checkCnpjSerpro(cnpj: string, service: 'CCMEI_DADOS' | 'SIT_FISCAL' = 'CCMEI_DADOS'): Promise<string> {
    try {
        const result = await consultarServico(service, cnpj);
        saveConsultation(cnpj, service, result, 200).catch(err =>
            console.error('[checkCnpjSerpro] Error saving:', err)
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
        // Ensure table exists
        try {
            await query(`
        CREATE TABLE IF NOT EXISTS interpreter_memories (
          id SERIAL PRIMARY KEY,
          phone VARCHAR(20) NOT NULL,
          content TEXT NOT NULL,
          category VARCHAR(50),
          embedding vector(1536),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
        } catch {
            await query(`
        CREATE TABLE IF NOT EXISTS interpreter_memories (
          id SERIAL PRIMARY KEY,
          phone VARCHAR(20) NOT NULL,
          content TEXT NOT NULL,
          category VARCHAR(50),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
        }

        if (action === 'post') {
            const truncatedText = text.substring(0, 1000);
            const embedding = await generateEmbedding(truncatedText);

            try {
                const memoryObj = { content: truncatedText, category, embedding: embedding || [], created_at: new Date().toISOString() };
                await redis.lpush(redisKey, JSON.stringify(memoryObj));
                await redis.ltrim(redisKey, 0, 49);
            } catch (err) {
                console.error('Redis write error:', err);
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
                console.error('Redis read error:', err);
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
        console.error('Interpreter error:', error);
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
        console.error('trackResourceDelivery error:', error);
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
        console.error('checkProcuracaoStatus error:', error);
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
        console.error('markProcuracaoCompleted error:', error);
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
        console.log(`[MessageSegment] Sent: ${segment.id} to ${phone}`);
    } catch (error) {
        console.error(`[MessageSegment] Error sending ${segment.id}:`, error);
    }
}
