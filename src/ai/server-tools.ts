import pool from '../lib/db';
import { query, withClient } from '../lib/db';
import redis from '../lib/redis';
import { cosineSimilarity, toWhatsAppJid } from '../lib/utils';
import { evolutionFindMessages, evolutionSendMediaMessage, evolutionSendTextMessage } from '../lib/evolution';
import { generateEmbedding } from './embedding';
import { consultarServico } from '../lib/serpro';
import { SERVICE_CONFIG } from '../lib/serpro-config';
import { saveConsultation, maybeSavePdfFromBotResult } from '../lib/serpro-db';
import { cnpjService } from '../lib/cnpj-service';
import { autoRegisterEmpresa, enrichEmpresaFromChat } from '../lib/empresa-auto-register';
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
        const { telefone, ...rawFields } = data;
        if (!telefone) return JSON.stringify({ status: 'error', message: 'Telefone is required' });

        const fields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawFields)) {
            if (v === 'true') fields[k] = true;
            else if (v === 'false') fields[k] = false;
            else fields[k] = v;
        }

        const resId = await query('SELECT id FROM leads WHERE telefone = $1 LIMIT 1', [telefone]);
        if (resId.rows.length === 0) return JSON.stringify({ status: 'not_found', message: 'Usuário não encontrado' });
        const leadId = resId.rows[0].id;

        let updatedData = {};
        const cryptoKey = process.env.PGCRYPTO_KEY ?? '';

        // Aliases de campos legados → nomes novos
        const fieldAliases: Record<string, string> = {
            servico_negociado: 'servico',
            servico_escolhido: 'servico',
            valor_divida_ativa: 'valor_divida_pgfn',
        };
        const normalizedFields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) {
            normalizedFields[fieldAliases[k] ?? k] = v;
        }

        // Adicionar CNPJ extra sem sobrescrever o principal
        if (normalizedFields['cnpj_adicionar']) {
            const cnpjExtra = String(normalizedFields['cnpj_adicionar']).replace(/\D/g, '');
            await query(
                `UPDATE leads SET
                    cnpjs_adicionais = CASE
                        WHEN cnpjs_adicionais IS NULL THEN $1::jsonb
                        WHEN cnpjs_adicionais @> $1::jsonb THEN cnpjs_adicionais
                        ELSE cnpjs_adicionais || $1::jsonb
                    END,
                    atualizado_em = NOW()
                WHERE telefone = $2`,
                [JSON.stringify([cnpjExtra]), telefone],
            );
            updatedData = { ...updatedData, cnpj_adicionado: cnpjExtra };
        }

        const leadsFields = ['nome_completo', 'email', 'cpf', 'data_nascimento', 'nome_mae', 'sexo',
            'cnpj', 'cnpj_ativo', 'razao_social', 'nome_fantasia', 'tipo_negocio', 'faturamento_mensal',
            'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep',
            'situacao', 'qualificacao', 'motivo_qualificacao', 'interesse_ajuda',
            'pos_qualificacao', 'possui_socio', 'confirmacao_qualificacao',
            'tem_divida', 'tipo_divida', 'valor_divida_municipal', 'valor_divida_estadual',
            'valor_divida_federal', 'valor_divida_pgfn', 'tempo_divida', 'calculo_parcelamento'];

        const processoFields = ['servico', 'status_atendimento', 'data_reuniao', 'procuracao',
            'procuracao_ativa', 'procuracao_validade', 'cliente', 'atendente_id',
            'envio_disparo', 'observacoes'];

        // --- Update leads ---
        const leadsSetClauses: string[] = [];
        const leadsValues: unknown[] = [];

        if (normalizedFields['senha_gov'] !== undefined) {
            const idx = leadsValues.length + 1;
            leadsSetClauses.push(`senha_gov_enc = CASE WHEN $${idx}::text IS NULL THEN senha_gov_enc ELSE pgp_sym_encrypt($${idx}::text, $${idx + 1}::text) END`);
            leadsValues.push(normalizedFields['senha_gov'], cryptoKey);
        }

        for (const field of leadsFields) {
            if (normalizedFields[field] !== undefined) {
                leadsSetClauses.push(`${field} = $${leadsValues.length + 1}`);
                leadsValues.push(normalizedFields[field]);
            }
        }

        if (leadsSetClauses.length > 0) {
            leadsValues.push(telefone);
            const updateRes = await query(
                `UPDATE leads SET ${leadsSetClauses.join(', ')}, atualizado_em = NOW() WHERE telefone = $${leadsValues.length} RETURNING *`,
                leadsValues,
            );
            if (updateRes.rows.length > 0) updatedData = { ...updatedData, ...updateRes.rows[0] };
        }

        // --- Upsert leads_processo ---
        const processoSetFields: string[] = [];
        const processoVals: unknown[] = [leadId];

        for (const field of processoFields) {
            if (normalizedFields[field] !== undefined) {
                if (field === 'observacoes') {
                    processoSetFields.push(`${field} = CASE WHEN ${field} IS NULL OR ${field} = '' THEN $${processoVals.length + 1} ELSE ${field} || E'\\n' || $${processoVals.length + 1} END`);
                } else {
                    processoSetFields.push(`${field} = $${processoVals.length + 1}`);
                }
                processoVals.push(normalizedFields[field]);
            }
        }

        if (normalizedFields['situacao'] !== undefined) {
            processoSetFields.push(`data_controle_24h = NOW()`);
        }

        if (processoSetFields.length > 0) {
            const insertCols = ['lead_id', ...processoFields.filter(f => normalizedFields[f] !== undefined)];
            const insertVals: unknown[] = [leadId, ...processoFields.filter(f => normalizedFields[f] !== undefined).map(f => normalizedFields[f])];
            const insertPlaceholders = insertVals.map((_, i) => `$${i + 1}`);

            await query(
                `INSERT INTO leads_processo (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})
                 ON CONFLICT (lead_id) DO UPDATE SET ${processoSetFields.join(', ')}, updated_at = NOW()`,
                insertVals,
            );
            updatedData = { ...updatedData, ...normalizedFields };
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
            `SELECT l.nome_completo FROM leads l JOIN leads_processo lp ON l.id = lp.lead_id WHERE lp.data_reuniao = $1`,
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
        const parsedDate = parseDateStr(dateStr);
        if (!parsedDate) return JSON.stringify({ status: 'error', message: 'Data inválida.' });
        await query(`
            INSERT INTO leads_processo (lead_id, data_reuniao)
            VALUES ($1, $2)
            ON CONFLICT (lead_id) DO UPDATE SET data_reuniao = $2, updated_at = NOW()
        `, [leadId, parsedDate]);
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
    
    // Enviar mensagem automaticamente para garantir entrega
    const message = `Aqui está o link do seu formulário de qualificação: ${link}\n\nPor favor, preencha para que possamos te ajudar da melhor forma! 😊`;
    const jid = toWhatsAppJid(phone);
    await evolutionSendTextMessage(jid, message);

    try {
        const { addToHistory } = await import('../lib/chat-history');
        await addToHistory(phone, 'assistant', message);
    } catch (e) {}

    return JSON.stringify({ link, message: `Formulário gerado e enviado com sucesso. O link é: ${link}.` });
}

export async function sendMeetingForm(phone: string): Promise<string> {
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://haylanderform.vercel.app';
    if (baseUrl.includes('loca.lt') || baseUrl.includes('ngrok-free.app')) {
        baseUrl = 'https://haylanderform.vercel.app';
    }
    baseUrl = baseUrl.replace(/\/$/, '');
    const link = `${baseUrl}/reuniao/${phone}`;
    
    // Enviar mensagem automaticamente para garantir entrega
    const message = `Separei um link para você escolher o melhor horário para nossa reunião: ${link}\n\nFico no aguardo do seu agendamento! 👇`;
    const jid = toWhatsAppJid(phone);
    await evolutionSendTextMessage(jid, message);

    try {
        const { addToHistory } = await import('../lib/chat-history');
        await addToHistory(phone, 'assistant', message);
    } catch (e) {}

    return JSON.stringify({ link, message: `Link de agendamento gerado e enviado: ${link}.` });
}

export async function sendEnumeratedList(phone: string): Promise<string> {
    const listText = `Escolha uma opção:\n\n1️⃣ Regularização MEI\n2️⃣ Abertura de MEI\n3️⃣ Falar com atendente\n4️⃣ Informações sobre os serviços\n5️⃣ Sair do atendimento`;
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
        const { getNextAvailableSlot } = await import('../lib/business-hours');
        const now = new Date();
        const scheduledDate = getNextAvailableSlot(now, 30);
        const formattedTime = scheduledDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const formattedDate = scheduledDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

        // 1. Atualizar lead para sinalizar necessidade de humano
        await query(`UPDATE leads SET needs_attendant = true, attendant_requested_at = NOW() WHERE telefone = $1`, [phone]);
        
        // 2. Tentar obter ID do lead para marcar na leads_processo
        const leadRes = await query(`SELECT id FROM leads WHERE telefone = $1`, [phone]);
        if (leadRes.rows.length > 0) {
            const leadId = leadRes.rows[0].id;
            await query(`
                INSERT INTO leads_processo (lead_id, data_reuniao, status_atendimento)
                VALUES ($1, $2, 'atendimento')
                ON CONFLICT (lead_id) DO UPDATE SET
                    data_reuniao       = EXCLUDED.data_reuniao,
                    status_atendimento = 'atendimento',
                    updated_at         = NOW()
            `, [leadId, scheduledDate]);
        }

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
            const text = `🔔 *Solicitação de Atendimento*\n\n` +
                         `👤 *Cliente:* ${phone}\n` +
                         `📝 *Motivo:* ${reason}\n` +
                         `📅 *Agendado para:* ${formattedDate} às ${formattedTime}\n` +
                         `🔗 *Chat:* https://wa.me/${phone.replace(/\D/g, '')}`;
            
            const evoLog = await evolutionSendTextMessage(toWhatsAppJid(attendantNumber), text);
            log.info(`[callAttendant] Evolution response for notifying attendant (${attendantNumber}):`, { evolution_log: evoLog });
            return JSON.stringify({ 
                status: 'success', 
                message: `Atendente notificado. Atendimento agendado para as ${formattedTime}. Aguarde um momento.`, 
                evolution_log: evoLog 
            });
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
        const res = await query(
            `SELECT id, name, value, description FROM services WHERE name ILIKE $1 ORDER BY name ASC`,
            [`%${searchQuery}%`]
        );
        if (res.rows.length > 0) return JSON.stringify(res.rows);
        const all = await query(`SELECT id, name, value, description FROM services ORDER BY name ASC`);
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

    const isSocialUrl = /instagram\.com|youtu|tiktok|facebook\.com/.test(mediaUrl);

    try {
        if (type === 'apc') {
            const evoLog = await evolutionSendMediaMessage(jid, mediaUrl, 'document', 'Apresentação Comercial Haylander', 'Apresentacao_Haylander.pdf', 'application/pdf');
            log.info(`[sendCommercialPresentation] APC sent for ${phone}`);
            try {
                const { notifySocketServer } = await import('../lib/socket');
                notifySocketServer('haylander-chat-updates', {
                    chatId: jid, fromMe: true,
                    message: { conversation: `[Apresentação Comercial enviada]` },
                    id: `msg-${Date.now()}`, messageTimestamp: Math.floor(Date.now() / 1000)
                }).catch(() => {});
            } catch (e) {}
            return JSON.stringify({ status: 'sent', message: 'Apresentação comercial enviada (PDF).', type, evolution_log: evoLog });
        } else {
            // URL social (Instagram, YouTube, etc): envia como mensagem de texto com link
            if (isSocialUrl) {
                const { evolutionSendTextMessage } = await import('../lib/evolution');
                const text = `🎥 *Vídeo Tutorial — Como criar a Procuração no e-CAC*\n\n${mediaUrl}\n\n_Assista antes de seguir os passos abaixo. O processo leva menos de 2 minutos._`;
                const evoLog = await evolutionSendTextMessage(jid, text);
                log.info(`[sendCommercialPresentation] Video tutorial (social URL) sent for ${phone}`);
                try {
                    const { notifySocketServer } = await import('../lib/socket');
                    notifySocketServer('haylander-chat-updates', {
                        chatId: jid, fromMe: true,
                        message: { conversation: `[Vídeo Tutorial enviado — ${mediaUrl}]` },
                        id: `msg-${Date.now()}`, messageTimestamp: Math.floor(Date.now() / 1000)
                    }).catch(() => {});
                } catch (e) {}
                return JSON.stringify({ status: 'sent', message: 'Link do vídeo tutorial enviado.', type, url: mediaUrl });
            }

            // URL de arquivo (R2/mp4): envia como vídeo
            const evoLog = await evolutionSendMediaMessage(jid, mediaUrl, 'video', 'Vídeo Tutorial', 'tutorial.mp4', 'video/mp4');
            log.info(`[sendCommercialPresentation] Video file sent for ${phone}`);
            try {
                const { notifySocketServer } = await import('../lib/socket');
                notifySocketServer('haylander-chat-updates', {
                    chatId: jid, fromMe: true,
                    message: { conversation: `[Vídeo Tutorial enviado]` },
                    id: `msg-${Date.now()}`, messageTimestamp: Math.floor(Date.now() / 1000)
                }).catch(() => {});
            } catch (e) {}
            return JSON.stringify({ status: 'sent', message: 'Vídeo tutorial enviado.', type, evolution_log: evoLog });
        }
    } catch (error) {
        log.error(`sendCommercialPresentation error ${type}:`, error);
        return JSON.stringify({ status: 'error', message: `Erro ao enviar ${type}: ${String(error)}` });
    }
}

// ==================== Cache-aware client data ====================

/**
 * Por quantos dias o resultado de cada serviço Serpro é considerado fresco.
 * Reflete a frequência real de mudança dos dados na Receita Federal.
 */
const FRESHNESS_DAYS: Record<string, number> = {
    CCMEI_DADOS:               90,  // dados cadastrais raramente mudam
    SIMEI:                     90,
    PROCURACAO:                30,  // pode ser revogada, checar mensalmente
    PGMEI:                      7,  // débitos DAS mudam após vencimento mensal
    PGFN_CONSULTAR:            30,
    DIVIDA_ATIVA:              30,
    PGMEI_EXTRATO:             30,
    PGMEI_BOLETO:              30,
    PGMEI_ATU_BENEFICIO:       30,
    SIT_FISCAL_SOLICITAR:      90,
    SIT_FISCAL_RELATORIO:      90,
    CND:                      180,
    CAIXA_POSTAL:               1,  // mensagens chegam diariamente
    DASN_SIMEI:               365,  // declaração anual
    DCTFWEB:                   30,
    PGDASD:                    30,
    PARCELAMENTO_MEI_CONSULTAR: 7,
    PARCELAMENTO_SN_CONSULTAR:  7,
};

/**
 * Retorna dados cadastrais do banco + histórico de consultas Serpro com indicador de frescor.
 * O bot deve chamar isso ANTES de qualquer tool Serpro para evitar consultas redundantes.
 */
export async function getClientDataWithFreshness(phone: string): Promise<string> {
    try {
        const leadRes = await query(`
            SELECT
                l.id, l.telefone, l.nome_completo, l.email, l.cpf,
                l.cnpj, l.razao_social, l.tipo_negocio, l.faturamento_mensal,
                l.tem_divida, l.tipo_divida, l.valor_divida_federal, l.valor_divida_pgfn,
                l.situacao, l.qualificacao, l.atualizado_em,
                lp.servico, lp.status_atendimento, lp.procuracao_ativa,
                lp.procuracao_validade, lp.observacoes
            FROM leads l
            LEFT JOIN leads_processo lp ON l.id = lp.lead_id
            WHERE l.telefone = $1
            LIMIT 1
        `, [phone]);

        if (leadRes.rows.length === 0) {
            return JSON.stringify({ status: 'not_found', message: 'Lead não encontrado.' });
        }
        const lead = leadRes.rows[0] as Record<string, unknown>;
        const cnpj = ((lead.cnpj as string | null) || '').replace(/\D/g, '');

        // Última consulta por serviço (somente sucesso status=200)
        let consultasFrescor: Record<string, unknown>[] = [];
        if (cnpj) {
            const cRes = await query(`
                SELECT DISTINCT ON (tipo_servico)
                    tipo_servico, resultado, created_at
                FROM consultas_serpro
                WHERE cnpj = $1 AND status = 200
                ORDER BY tipo_servico, created_at DESC
            `, [cnpj]);

            const now = Date.now();
            consultasFrescor = cRes.rows.map(row => {
                const service = row.tipo_servico as string;
                const freshnessDays = FRESHNESS_DAYS[service] ?? 7;
                const fetchedAt = new Date(row.created_at as string);
                const ageDays = Math.floor((now - fetchedAt.getTime()) / 86_400_000);
                const aindaValido = ageDays < freshnessDays;
                return {
                    servico: service,
                    ultima_consulta: fetchedAt.toLocaleDateString('pt-BR'),
                    dias_atras: ageDays,
                    valido_por_dias: freshnessDays,
                    ainda_valido: aindaValido,
                    proximo_refresh: aindaValido ? `em ${freshnessDays - ageDays} dia(s)` : 'ATUALIZAR AGORA',
                    resultado: row.resultado,
                };
            });
        }

        // Documentos PDF ainda válidos (CND, SITFIS, DAS)
        let documentosValidos: Record<string, unknown>[] = [];
        if (cnpj) {
            const docRes = await query(`
                SELECT tipo_servico, r2_url, valido_ate, created_at
                FROM serpro_documentos
                WHERE cnpj = $1
                  AND deletado_em IS NULL
                  AND (valido_ate IS NULL OR valido_ate > NOW())
                ORDER BY created_at DESC
                LIMIT 10
            `, [cnpj]);
            documentosValidos = docRes.rows.map(row => ({
                servico: row.tipo_servico,
                url: row.r2_url,
                valido_ate: row.valido_ate ? new Date(row.valido_ate as string).toLocaleDateString('pt-BR') : null,
                gerado_em: new Date(row.created_at as string).toLocaleDateString('pt-BR'),
            }));
        }

        return JSON.stringify({
            status: 'success',
            dados_cadastro: {
                fonte: 'banco_de_dados',
                atualizado_em: lead.atualizado_em
                    ? new Date(lead.atualizado_em as string).toLocaleDateString('pt-BR')
                    : null,
                dados: {
                    nome: lead.nome_completo,
                    cpf: lead.cpf,
                    cnpj: lead.cnpj,
                    razao_social: lead.razao_social,
                    tipo_negocio: lead.tipo_negocio,
                    faturamento_mensal: lead.faturamento_mensal,
                    tem_divida: lead.tem_divida,
                    tipo_divida: lead.tipo_divida,
                    valor_divida_federal: lead.valor_divida_federal,
                    valor_divida_pgfn: lead.valor_divida_pgfn,
                    situacao: lead.situacao,
                    qualificacao: lead.qualificacao,
                    procuracao_ativa: lead.procuracao_ativa ?? false,
                    procuracao_validade: lead.procuracao_validade,
                    status_atendimento: lead.status_atendimento,
                    observacoes: lead.observacoes,
                },
            },
            consultas_serpro: consultasFrescor,
            documentos_validos: documentosValidos,
            regras_frescor: FRESHNESS_DAYS,
            instrucao: 'Se ainda_valido=true use o campo "resultado" diretamente. Só chame a tool Serpro se ainda_valido=false ou serviço ausente da lista.',
        });
    } catch (error) {
        log.error('getClientDataWithFreshness error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

// ==================== Serpro ====================

export async function checkCnpjSerpro(cnpj: string, service: keyof typeof SERVICE_CONFIG = 'CCMEI_DADOS', options: any = {}): Promise<string> {
    try {
        log.info(`[checkCnpjSerpro] Solicitando serviço ${service} para CNPJ ${cnpj}...`);
        const result = await consultarServico(service, cnpj, options);
        saveConsultation(cnpj, service, result, 200).catch(err =>
            log.error('[checkCnpjSerpro] Error saving:', err)
        );
        maybeSavePdfFromBotResult(cnpj, service, result, options.protocoloRelatorio).catch(err =>
            log.error('[checkCnpjSerpro] Error saving PDF to R2:', err)
        );

        // Se o status é 200, significa que temos conexão/procuração ativa.
        try {
            const cleanCnpj = cnpj.replace(/\D/g, '');
            const resLead = await pool.query("SELECT id AS lead_id FROM leads WHERE REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') = $1 LIMIT 1", [cleanCnpj]);
            if (resLead.rows.length > 0) {
                await markProcuracaoCompleted(resLead.rows[0].lead_id);
                log.info(`[checkCnpjSerpro] Status de procuração sincronizado para CNPJ ${cleanCnpj}`);
            }
        } catch (syncErr) {
            log.error('[checkCnpjSerpro] Erro ao sincronizar status de procuração:', syncErr);
        }

        return JSON.stringify(result);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Detecção inteligente de falta de procuração no Serpro
        if (errorMessage.includes('40011') || errorMessage.includes('AUT-403') || errorMessage.includes('AutorizacaoNegada')) {
            return JSON.stringify({ 
                status: 'error', 
                error_type: 'procuracao_ausente',
                message: 'Acesso negado. O contribuinte não outorgou procuração para este serviço no e-CAC.' 
            });
        }

        log.error(`[checkCnpjSerpro] Falha na consulta ${service} para CNPJ ${cnpj}:`, error);
        return JSON.stringify({ status: 'error', message: errorMessage });
    }
}

export async function consultarProcuracaoSerpro(cnpj: string): Promise<string> {
    return checkCnpjSerpro(cnpj, 'PROCURACAO');
}

/**
 * Consulta dados PÚBLICOS de qualquer CNPJ usando a BrasilAPI e VERIFICA acesso Serpro.
 * Esta ferramenta é a principal validação para saber se a procuração e-CAC está ativa.
 */
export async function consultarCnpjPublico(cnpj: string, userPhone?: string): Promise<string> {
    const cleanCnpj = cnpj.replace(/\D/g, '');
    const results = {
        cnpj: cleanCnpj,
        public_data: null as any,
        is_mei: false,
        ficha_auto_preenchida: {} as Record<string, unknown>,
        serpro_access: {
            active: false,
            error_type: null as string | null,
            message: null as string | null
        }
    };

    try {
        // 1. Dados públicos via BrasilAPI
        const publicResult = await cnpjService.consultarCNPJ(cnpj);
        if (publicResult.success && publicResult.data) {
            const d = publicResult.data;
            results.public_data = d;
            saveConsultation(cleanCnpj, 'CNPJ_API', d, 200, 'bot').catch(() => {});

            // Detecta MEI via natureza jurídica (código 213-5 = Empresário Individual = MEI)
            const natJur = (d.natureza_juridica || '').toLowerCase();
            results.is_mei = natJur.includes('213-5') || natJur.includes('empresário (individual)') || natJur.includes('empresario (individual)');

            // Monta ficha a partir de dados públicos para auto-preenchimento
            const ficha: Record<string, unknown> = {
                cnpj: cleanCnpj,
                razao_social: d.razao_social || undefined,
                nome_fantasia: d.nome_fantasia || undefined,
                tipo_negocio: d.atividades_principais?.[0]?.text || undefined,
                endereco: d.endereco?.logradouro || undefined,
                numero: d.endereco?.numero || undefined,
                complemento: d.endereco?.complemento || undefined,
                bairro: d.endereco?.bairro || undefined,
                cidade: d.endereco?.municipio || undefined,
                estado: d.endereco?.uf || undefined,
                cep: d.endereco?.cep || undefined,
            };
            // Email público só se presente
            if (d.email) ficha.email = d.email;

            // Remove undefined
            Object.keys(ficha).forEach(k => ficha[k] === undefined && delete ficha[k]);
            results.ficha_auto_preenchida = ficha;

            // Auto-popula o lead se tiver telefone (contexto do bot)
            if (userPhone && Object.keys(ficha).length > 0) {
                updateUser({ telefone: userPhone, ...ficha }).catch(err =>
                    log.error('[consultarCnpjPublico] Erro ao auto-preencher lead:', err)
                );
            }
        } else {
            log.warn(`[consultarCnpjPublico] Falha BrasilAPI para ${cleanCnpj}: ${publicResult.error?.message}`);
        }

        // 2. Valida Procuração via Serpro
        try {
            const serproRaw = await checkCnpjSerpro(cleanCnpj, 'PROCURACAO');
            const serproData = JSON.parse(serproRaw);
            if (serproData.status === 'error') {
                results.serpro_access = { active: false, error_type: serproData.error_type || 'unknown_error', message: serproData.message };
            } else {
                results.serpro_access = { active: true, error_type: null, message: 'Procuração e-CAC ativa no Serpro.' };
            }
        } catch (serproErr) {
            results.serpro_access = { active: false, error_type: 'connection_error', message: String(serproErr) };
        }

        const instruction = results.serpro_access.active
            ? 'Procuração ATIVA. Prossiga com consultas Serpro (PGMEI, SITFIS).'
            : results.is_mei
                ? 'Lead é MEI. Procuração AUSENTE — explique que a procuração e-CAC é OBRIGATÓRIA para prestarmos o serviço corretamente. Use enviar_processo_autonomo para enviar o tutorial.'
                : 'Procuração AUSENTE — explique que a procuração e-CAC é OBRIGATÓRIA para prestarmos o serviço corretamente. Use enviar_processo_autonomo para enviar o tutorial.';

        return JSON.stringify({ status: 'success', ...results, instruction });

    } catch (error) {
        log.error(`[consultarCnpjPublico] Fatal error for ${cleanCnpj}:`, error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}

export async function consultarDividaAtivaGeralSerpro(cnpj: string): Promise<string> {
    return checkCnpjSerpro(cnpj, 'PGFN_CONSULTAR');
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

// Registra um recurso entregue no JSONB recursos_entregues de leads_processo
export async function trackResourceDelivery(
    leadId: number,
    resourceType: string,
    resourceKey: string,
    metadata?: Record<string, unknown>
): Promise<void> {
    try {
        const entry = {
            delivered_at: new Date().toISOString(),
            status: 'delivered',
            ...(metadata || {}),
        };
        await query(`
            INSERT INTO leads_processo (lead_id, recursos_entregues)
            VALUES ($1, $2::jsonb)
            ON CONFLICT (lead_id) DO UPDATE SET
                recursos_entregues = leads_processo.recursos_entregues || $2::jsonb,
                updated_at = NOW()
        `, [leadId, JSON.stringify({ [`${resourceType}:${resourceKey}`]: entry })]);
    } catch (error) {
        log.error('trackResourceDelivery error:', error);
    }
}

// Verifica se a procuração foi confirmada via leads_processo (fonte única de verdade)
export async function checkProcuracaoStatus(leadId: number): Promise<boolean> {
    try {
        const result = await query(`
            SELECT procuracao_ativa FROM leads_processo
            WHERE lead_id = $1 AND procuracao_ativa = true
            LIMIT 1
        `, [leadId]);
        return result.rows.length > 0;
    } catch (error) {
        log.error('checkProcuracaoStatus error:', error);
        return false;
    }
}

// Marca procuração como confirmada — única escrita, em leads_processo
export async function markProcuracaoCompleted(leadId: number): Promise<void> {
    try {
        const validoAte = new Date(Date.now() + 365 * 86_400_000).toISOString().split('T')[0];
        const recursoEntry = {
            'video-tutorial:video-tutorial-procuracao-ecac': {
                delivered_at: new Date().toISOString(),
                accessed_at: new Date().toISOString(),
                status: 'completed',
            },
        };
        await query(`
            INSERT INTO leads_processo (lead_id, procuracao, procuracao_ativa, procuracao_validade, recursos_entregues)
            VALUES ($1, true, true, $2, $3::jsonb)
            ON CONFLICT (lead_id) DO UPDATE SET
                procuracao           = true,
                procuracao_ativa     = true,
                procuracao_validade  = $2,
                recursos_entregues   = leads_processo.recursos_entregues || $3::jsonb,
                updated_at           = NOW()
        `, [leadId, validoAte, JSON.stringify(recursoEntry)]);

        log.info(`[markProcuracaoCompleted] Lead ${leadId} marcado como COM PROCURAÇÃO (válida até ${validoAte}).`);

        // Cadastro automático no Integra Contador + enriquecimento via chat (fire-and-forget)
        autoRegisterEmpresa(leadId).then(({ empresaId, phone }) => {
            if (empresaId && phone) {
                enrichEmpresaFromChat(empresaId, phone).catch(() => undefined);
            }
        }).catch(() => undefined);

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
            const { addToHistory } = await import('../lib/chat-history');
            let historyText = segment.content;
            if (segment.type === 'link' && segment.metadata?.url) historyText += '\n' + segment.metadata.url;
            if (segment.type === 'media') historyText = `[Midia: ${segment.metadata?.mediaKey || 'arquivo'}]`;
            await addToHistory(phone, 'assistant', historyText);

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
        leads: ['nome_completo', 'email', 'cpf', 'data_nascimento', 'nome_mae', 'senha_gov', 'sexo',
            'cnpj', 'razao_social', 'nome_fantasia', 'tipo_negocio', 'faturamento_mensal',
            'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep',
            'situacao', 'qualificacao', 'motivo_qualificacao', 'interesse_ajuda',
            'pos_qualificacao', 'possui_socio', 'confirmacao_qualificacao',
            'tem_divida', 'tipo_divida', 'valor_divida_municipal', 'valor_divida_estadual',
            'valor_divida_federal', 'valor_divida_pgfn', 'tempo_divida', 'calculo_parcelamento'],
        leads_processo: ['servico', 'status_atendimento', 'data_reuniao', 'procuracao',
            'procuracao_ativa', 'procuracao_validade', 'cliente', 'atendente_id',
            'envio_disparo', 'observacoes'],
    };
    return JSON.stringify({
        instrucoes: "Para atualizar os dados do cliente centralmente, chame update_user enviando os campos desejados na raiz do JSON (ex: { situacao: 'qualificado', email: 'x@y.com' }). Use a tabela abaixo para saber EXATAMENTE como os campos se chamam no banco. Aliases aceitos: servico_negociado/servico_escolhido → servico | valor_divida_ativa → valor_divida_pgfn.",
        tabelas_e_campos: tableMappings
    }, null, 2);
}
