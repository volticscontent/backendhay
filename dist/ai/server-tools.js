"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUser = getUser;
exports.createUser = createUser;
exports.updateUser = updateUser;
exports.setAgentRouting = setAgentRouting;
exports.getAgentRouting = getAgentRouting;
exports.checkAvailability = checkAvailability;
exports.scheduleMeeting = scheduleMeeting;
exports.tryScheduleMeeting = tryScheduleMeeting;
exports.sendForm = sendForm;
exports.sendMeetingForm = sendMeetingForm;
exports.sendEnumeratedList = sendEnumeratedList;
exports.callAttendant = callAttendant;
exports.contextRetrieve = contextRetrieve;
exports.searchServices = searchServices;
exports.getAvailableMedia = getAvailableMedia;
exports.sendMedia = sendMedia;
exports.sendCommercialPresentation = sendCommercialPresentation;
exports.checkCnpjSerpro = checkCnpjSerpro;
exports.consultarProcuracaoSerpro = consultarProcuracaoSerpro;
exports.consultarDividaAtivaGeralSerpro = consultarDividaAtivaGeralSerpro;
exports.interpreter = interpreter;
exports.trackResourceDelivery = trackResourceDelivery;
exports.checkProcuracaoStatus = checkProcuracaoStatus;
exports.markProcuracaoCompleted = markProcuracaoCompleted;
exports.sendMessageSegment = sendMessageSegment;
exports.getUpdatableFields = getUpdatableFields;
const db_1 = __importDefault(require("../lib/db"));
const db_2 = require("../lib/db");
const redis_1 = __importDefault(require("../lib/redis"));
const utils_1 = require("../lib/utils");
const evolution_1 = require("../lib/evolution");
const embedding_1 = require("./embedding");
const serpro_1 = require("../lib/serpro");
const serpro_db_1 = require("../lib/serpro-db");
const logger_1 = __importDefault(require("../lib/logger"));
const log = logger_1.default.child('ServerTools');
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
function extractMessageText(raw) {
    if (!isObject(raw))
        return null;
    if (typeof raw.conversation === 'string' && raw.conversation.trim())
        return raw.conversation;
    if (isObject(raw.extendedTextMessage) && typeof raw.extendedTextMessage.text === 'string')
        return raw.extendedTextMessage.text;
    if (isObject(raw.imageMessage))
        return (typeof raw.imageMessage.caption === 'string' && raw.imageMessage.caption.trim()) ? raw.imageMessage.caption : '[imagem]';
    if (isObject(raw.documentMessage))
        return (typeof raw.documentMessage.caption === 'string') ? raw.documentMessage.caption : '[documento]';
    if (isObject(raw.audioMessage))
        return '[audio]';
    if (isObject(raw.videoMessage))
        return '[video]';
    if (isObject(raw.stickerMessage))
        return '[sticker]';
    return null;
}
function parseDateStr(dateStr) {
    const parts = dateStr.split(' ');
    if (parts.length !== 2)
        return null;
    const [datePart, timePart] = parts;
    const dateSplit = datePart.split('/');
    const timeSplit = timePart.split(':');
    if (dateSplit.length !== 3 || timeSplit.length !== 2)
        return null;
    const d = new Date(parseInt(dateSplit[2]), parseInt(dateSplit[1]) - 1, parseInt(dateSplit[0]), parseInt(timeSplit[0]), parseInt(timeSplit[1]));
    return isNaN(d.getTime()) ? null : d;
}
// ==================== CRUD ====================
async function getUser(phone) {
    try {
        const res = await (0, db_2.query)('SELECT * FROM leads WHERE telefone = $1 LIMIT 1', [phone]);
        if (res.rows.length === 0)
            return JSON.stringify({ status: 'not_found' });
        return JSON.stringify(res.rows[0]);
    }
    catch (error) {
        log.error('getUser error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
async function createUser(data) {
    try {
        const { nome_completo, telefone } = data;
        const email = data.email || null;
        const res = await (0, db_2.query)(`INSERT INTO leads (nome_completo, telefone, email, data_cadastro) VALUES ($1, $2, $3, NOW()) RETURNING *`, [nome_completo, telefone, email]);
        log.info(`[createUser] Success: ${telefone}`, { result: res.rows[0] });
        return JSON.stringify({ status: 'success', id: res.rows[0].id, result: res.rows[0] });
    }
    catch (error) {
        log.error('createUser error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
async function updateUser(data) {
    try {
        const { telefone, ...rawFields } = data;
        if (!telefone)
            return JSON.stringify({ status: 'error', message: 'Telefone is required' });
        const fields = {};
        for (const [k, v] of Object.entries(rawFields)) {
            if (v === 'true')
                fields[k] = true;
            else if (v === 'false')
                fields[k] = false;
            else
                fields[k] = v;
        }
        const resId = await (0, db_2.query)('SELECT id FROM leads WHERE telefone = $1 LIMIT 1', [telefone]);
        if (resId.rows.length === 0)
            return JSON.stringify({ status: 'not_found', message: 'Usuário não encontrado' });
        const leadId = resId.rows[0].id;
        let updatedData = {};
        const cryptoKey = process.env.PGCRYPTO_KEY ?? '';
        // Aliases de campos legados → nomes novos
        const fieldAliases = {
            servico_negociado: 'servico',
            servico_escolhido: 'servico',
            valor_divida_ativa: 'valor_divida_pgfn',
        };
        const normalizedFields = {};
        for (const [k, v] of Object.entries(fields)) {
            normalizedFields[fieldAliases[k] ?? k] = v;
        }
        const leadsFields = ['nome_completo', 'email', 'cpf', 'data_nascimento', 'nome_mae', 'sexo',
            'cnpj', 'razao_social', 'nome_fantasia', 'tipo_negocio', 'faturamento_mensal',
            'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep',
            'situacao', 'qualificacao', 'motivo_qualificacao', 'interesse_ajuda',
            'pos_qualificacao', 'possui_socio', 'confirmacao_qualificacao',
            'tem_divida', 'tipo_divida', 'valor_divida_municipal', 'valor_divida_estadual',
            'valor_divida_federal', 'valor_divida_pgfn', 'tempo_divida', 'calculo_parcelamento'];
        const processoFields = ['servico', 'status_atendimento', 'data_reuniao', 'procuracao',
            'procuracao_ativa', 'procuracao_validade', 'cliente', 'atendente_id',
            'envio_disparo', 'observacoes'];
        // --- Update leads ---
        const leadsSetClauses = [];
        const leadsValues = [];
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
            const updateRes = await (0, db_2.query)(`UPDATE leads SET ${leadsSetClauses.join(', ')}, atualizado_em = NOW() WHERE telefone = $${leadsValues.length} RETURNING *`, leadsValues);
            if (updateRes.rows.length > 0)
                updatedData = { ...updatedData, ...updateRes.rows[0] };
        }
        // --- Upsert leads_processo ---
        const processoSetFields = [];
        const processoVals = [leadId];
        for (const field of processoFields) {
            if (normalizedFields[field] !== undefined) {
                if (field === 'observacoes') {
                    processoSetFields.push(`${field} = CASE WHEN ${field} IS NULL OR ${field} = '' THEN $${processoVals.length + 1} ELSE ${field} || E'\\n' || $${processoVals.length + 1} END`);
                }
                else {
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
            const insertVals = [leadId, ...processoFields.filter(f => normalizedFields[f] !== undefined).map(f => normalizedFields[f])];
            const insertPlaceholders = insertVals.map((_, i) => `$${i + 1}`);
            await (0, db_2.query)(`INSERT INTO leads_processo (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})
                 ON CONFLICT (lead_id) DO UPDATE SET ${processoSetFields.join(', ')}, updated_at = NOW()`, insertVals);
            updatedData = { ...updatedData, ...normalizedFields };
        }
        log.info(`[updateUser] Success: ${telefone}`);
        return JSON.stringify({ status: 'success', message: 'User updated', result: updatedData });
    }
    catch (error) {
        log.error('updateUser error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
// ==================== Routing ====================
async function setAgentRouting(phone, agent) {
    const redisKey = `routing_override:${phone}`;
    try {
        if (agent) {
            await redis_1.default.set(redisKey, agent, 'EX', 86400);
            return JSON.stringify({ status: 'success', message: `Routing override set to ${agent}` });
        }
        else {
            await redis_1.default.del(redisKey);
            return JSON.stringify({ status: 'success', message: 'Routing override cleared' });
        }
    }
    catch (error) {
        log.error('setAgentRouting error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
async function getAgentRouting(phone) {
    try {
        return await redis_1.default.get(`routing_override:${phone}`);
    }
    catch (error) {
        log.error('getAgentRouting error:', error);
        return null;
    }
}
// ==================== Scheduling ====================
async function checkAvailability(dateStr) {
    try {
        if (!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(dateStr)) {
            return JSON.stringify({ available: false, message: 'Formato de data inválido. Use dd/MM/yyyy HH:mm' });
        }
        const parsedDate = parseDateStr(dateStr);
        if (!parsedDate)
            return JSON.stringify({ available: false, message: 'Data inválida.' });
        const res = await (0, db_2.query)(`SELECT l.nome_completo FROM leads l JOIN leads_processo lp ON l.id = lp.lead_id WHERE lp.data_reuniao = $1`, [parsedDate]);
        return JSON.stringify({ available: res.rows.length === 0, message: res.rows.length > 0 ? 'Horário indisponível.' : 'Horário disponível.' });
    }
    catch (error) {
        log.error('checkAvailability error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
async function scheduleMeeting(phone, dateStr) {
    try {
        const userRes = await (0, db_2.query)('SELECT id FROM leads WHERE telefone = $1', [phone]);
        if (userRes.rows.length === 0)
            return JSON.stringify({ status: 'error', message: 'Usuário não encontrado.' });
        const leadId = userRes.rows[0].id;
        const parsedDate = parseDateStr(dateStr);
        if (!parsedDate)
            return JSON.stringify({ status: 'error', message: 'Data inválida.' });
        await (0, db_2.query)(`
            INSERT INTO leads_processo (lead_id, data_reuniao)
            VALUES ($1, $2)
            ON CONFLICT (lead_id) DO UPDATE SET data_reuniao = $2, updated_at = NOW()
        `, [leadId, parsedDate]);
        return JSON.stringify({ status: 'success', message: `Reunião agendada para ${dateStr}` });
    }
    catch (error) {
        log.error('scheduleMeeting error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
async function tryScheduleMeeting(phone, dateStr) {
    const avail = await checkAvailability(dateStr);
    const availJson = JSON.parse(avail);
    if (availJson.available)
        return await scheduleMeeting(phone, dateStr);
    return JSON.stringify({ status: 'unavailable', message: availJson.message || 'Horário indisponível.' });
}
// ==================== Formulários e Listas ====================
async function sendForm(phone, observacao) {
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://haylanderform.vercel.app';
    if (baseUrl.includes('loca.lt') || baseUrl.includes('ngrok-free.app')) {
        baseUrl = 'https://haylanderform.vercel.app';
    }
    baseUrl = baseUrl.replace(/\/$/, '');
    const link = `${baseUrl}/${phone}`;
    await updateUser({ telefone: phone, observacoes: `Interesse: ${observacao}` });
    // Enviar mensagem automaticamente para garantir entrega
    const message = `Aqui está o link do seu formulário de qualificação: ${link}\n\nPor favor, preencha para que possamos te ajudar da melhor forma! 😊`;
    const jid = (0, utils_1.toWhatsAppJid)(phone);
    await (0, evolution_1.evolutionSendTextMessage)(jid, message);
    try {
        const { addToHistory } = await Promise.resolve().then(() => __importStar(require('../lib/chat-history')));
        await addToHistory(phone, 'assistant', message);
    }
    catch (e) { }
    return JSON.stringify({ link, message: `Formulário gerado e enviado com sucesso. O link é: ${link}.` });
}
async function sendMeetingForm(phone) {
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://haylanderform.vercel.app';
    if (baseUrl.includes('loca.lt') || baseUrl.includes('ngrok-free.app')) {
        baseUrl = 'https://haylanderform.vercel.app';
    }
    baseUrl = baseUrl.replace(/\/$/, '');
    const link = `${baseUrl}/reuniao/${phone}`;
    // Enviar mensagem automaticamente para garantir entrega
    const message = `Separei um link para você escolher o melhor horário para nossa reunião: ${link}\n\nFico no aguardo do seu agendamento! 👇`;
    const jid = (0, utils_1.toWhatsAppJid)(phone);
    await (0, evolution_1.evolutionSendTextMessage)(jid, message);
    try {
        const { addToHistory } = await Promise.resolve().then(() => __importStar(require('../lib/chat-history')));
        await addToHistory(phone, 'assistant', message);
    }
    catch (e) { }
    return JSON.stringify({ link, message: `Link de agendamento gerado e enviado: ${link}.` });
}
async function sendEnumeratedList(phone) {
    const listText = `Escolha uma opção:\n\n1️⃣ Regularização MEI\n2️⃣ Abertura de MEI\n3️⃣ Falar com atendente\n4️⃣ Informações sobre os serviços\n5️⃣ Sair do atendimento`;
    try {
        const jid = (0, utils_1.toWhatsAppJid)(phone);
        const evoLog = await (0, evolution_1.evolutionSendTextMessage)(jid, listText);
        log.info(`[sendEnumeratedList] Evolution response for ${phone}:`, { evolution_log: evoLog });
        // Registrar no histórico para manter contexto entre agente e cliente
        const { addToHistory } = await Promise.resolve().then(() => __importStar(require('../lib/chat-history')));
        await addToHistory(phone, 'assistant', listText);
        // Notificar socket para o painel admin ver a mensagem
        // 3) Emitir mensagem WebSocket para atualizar a UI do atendente em tempo real
        const { notifySocketServer } = await Promise.resolve().then(() => __importStar(require('../lib/socket')));
        notifySocketServer('haylander-chat-updates', {
            chatId: jid,
            fromMe: true, // O bot enviou
            message: { conversation: listText },
            id: `msg-${Date.now()}`,
            messageTimestamp: Math.floor(Date.now() / 1000)
        }).catch(err => log.error('Erro ao notificar via Socket.io Server', err));
        return JSON.stringify({ status: 'success', message: 'Lista enviada ao cliente com sucesso.', evolution_log: evoLog });
    }
    catch (error) {
        log.error('sendEnumeratedList error:', error);
        return JSON.stringify({ status: 'error', message: `Falha ao enviar lista: ${String(error)}` });
    }
}
// ==================== Atendente ====================
async function callAttendant(phone, reason = 'Solicitação do cliente') {
    try {
        const { getNextAvailableSlot } = await Promise.resolve().then(() => __importStar(require('../lib/business-hours')));
        const now = new Date();
        const scheduledDate = getNextAvailableSlot(now, 30);
        const formattedTime = scheduledDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const formattedDate = scheduledDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        // 1. Atualizar lead para sinalizar necessidade de humano
        await (0, db_2.query)(`UPDATE leads SET needs_attendant = true, attendant_requested_at = NOW() WHERE telefone = $1`, [phone]);
        // 2. Tentar obter ID do lead para marcar na leads_processo
        const leadRes = await (0, db_2.query)(`SELECT id FROM leads WHERE telefone = $1`, [phone]);
        if (leadRes.rows.length > 0) {
            const leadId = leadRes.rows[0].id;
            await (0, db_2.query)(`
                INSERT INTO leads_processo (lead_id, data_reuniao, status_atendimento)
                VALUES ($1, $2, 'atendimento')
                ON CONFLICT (lead_id) DO UPDATE SET
                    data_reuniao       = EXCLUDED.data_reuniao,
                    status_atendimento = 'atendimento',
                    updated_at         = NOW()
            `, [leadId, scheduledDate]);
        }
        await redis_1.default.set(`attendant_requested:${phone}`, reason, 'EX', 86400); // 24h
        // Notificar via WebSocket para o painel (ChatInterface/Frontend) atualizar realtime
        try {
            const { notifySocketServer } = await Promise.resolve().then(() => __importStar(require('../lib/socket')));
            await notifySocketServer('haylander-chat-updates', {
                type: 'attendant-requested',
                phone: phone,
                reason: reason
            });
        }
        catch (socketErr) {
            log.warn('Erro ao notificar socket sobre request de atendente:', socketErr);
        }
        const attendantNumber = process.env.ATTENDANT_PHONE;
        if (attendantNumber) {
            const text = `🔔 *Solicitação de Atendimento*\n\n` +
                `👤 *Cliente:* ${phone}\n` +
                `📝 *Motivo:* ${reason}\n` +
                `📅 *Agendado para:* ${formattedDate} às ${formattedTime}\n` +
                `🔗 *Chat:* https://wa.me/${phone.replace(/\D/g, '')}`;
            const evoLog = await (0, evolution_1.evolutionSendTextMessage)((0, utils_1.toWhatsAppJid)(attendantNumber), text);
            log.info(`[callAttendant] Evolution response for notifying attendant (${attendantNumber}):`, { evolution_log: evoLog });
            return JSON.stringify({
                status: 'success',
                message: `Atendente notificado. Atendimento agendado para as ${formattedTime}. Aguarde um momento.`,
                evolution_log: evoLog
            });
        }
        log.warn('Atenção: Atendente solicitado, mas ATTENDANT_PHONE não está configurado no .env.');
        return JSON.stringify({ status: 'success', message: 'Solicitação registrada. Aguarde um momento.' });
    }
    catch (error) {
        log.error('callAttendant error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
// ==================== Context & Services ====================
async function contextRetrieve(phone, limit = 30) {
    try {
        const jid = (0, utils_1.toWhatsAppJid)(phone);
        const data = await (0, evolution_1.evolutionFindMessages)(jid, limit);
        const records = data?.messages?.records;
        if (!Array.isArray(records))
            return '[]';
        const messages = records.map((m) => {
            const text = extractMessageText(m.message);
            if (!text)
                return null;
            return `[${m.key.fromMe ? 'Bot' : 'User'}] ${text}`;
        }).filter(Boolean).reverse();
        return JSON.stringify(messages);
    }
    catch (error) {
        log.error('contextRetrieve error:', error);
        return '[]';
    }
}
async function searchServices(searchQuery) {
    try {
        const res = await (0, db_2.query)(`SELECT id, name, value, description FROM services WHERE name ILIKE $1 ORDER BY name ASC`, [`%${searchQuery}%`]);
        if (res.rows.length > 0)
            return JSON.stringify(res.rows);
        const all = await (0, db_2.query)(`SELECT id, name, value, description FROM services ORDER BY name ASC`);
        return JSON.stringify(all.rows);
    }
    catch (error) {
        log.error('searchServices error:', error);
        return '[]';
    }
}
// ==================== Mídia ====================
async function getAvailableMedia() {
    const defaults = [
        { key: 'apc', description: 'Apresentação Comercial (PDF)', type: 'document' },
        { key: 'video_institucional', description: 'Vídeo Institucional', type: 'video' }
    ];
    try {
        const { listFilesFromR2 } = await Promise.resolve().then(() => __importStar(require('../lib/r2')));
        const files = await listFilesFromR2();
        const validExts = ['.pdf', '.mp4', '.jpg', '.jpeg', '.png'];
        const mediaFiles = files
            .filter((f) => validExts.some(ext => f.key.toLowerCase().endsWith(ext)) && !f.key.includes('private'))
            .map((f) => ({
            key: f.key,
            description: f.key.split('/').pop()?.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '') || f.key,
            type: f.key.endsWith('.mp4') ? 'video' : f.key.endsWith('.pdf') ? 'document' : 'image',
            url: f.url,
        }));
        return JSON.stringify([...defaults, ...mediaFiles]);
    }
    catch {
        return JSON.stringify(defaults);
    }
}
async function sendMedia(phone, keyOrUrl) {
    if (keyOrUrl === 'apc')
        return sendCommercialPresentation(phone, 'apc');
    if (keyOrUrl === 'video_institucional' || keyOrUrl === 'video' || keyOrUrl === 'video-tutorial-procuracao-ecac')
        return sendCommercialPresentation(phone, 'video');
    let mediaUrl = keyOrUrl;
    const fileName = keyOrUrl.split('/').pop() || 'arquivo';
    if (!keyOrUrl.startsWith('http')) {
        const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
        if (R2_PUBLIC_URL) {
            mediaUrl = `${R2_PUBLIC_URL.replace(/\/$/, '')}/${keyOrUrl}`;
        }
        else {
            return JSON.stringify({ status: 'error', message: 'URL base do R2 não configurada.' });
        }
    }
    const ext = mediaUrl.split('.').pop()?.toLowerCase();
    let mediaType = 'document';
    let mimetype = 'application/octet-stream';
    if (['mp4', 'mov', 'avi'].includes(ext || '')) {
        mediaType = 'video';
        mimetype = 'video/mp4';
    }
    else if (['jpg', 'jpeg', 'png', 'gif'].includes(ext || '')) {
        mediaType = 'image';
        mimetype = 'image/jpeg';
    }
    else if (['mp3', 'ogg', 'wav'].includes(ext || '')) {
        mediaType = 'audio';
        mimetype = 'audio/mpeg';
    }
    else if (ext === 'pdf') {
        mediaType = 'document';
        mimetype = 'application/pdf';
    }
    try {
        const evoLog = await (0, evolution_1.evolutionSendMediaMessage)((0, utils_1.toWhatsAppJid)(phone), mediaUrl, mediaType, fileName, fileName, mimetype);
        log.info(`[sendMedia] Evolution response for ${phone}:`, { evolution_log: evoLog });
        try {
            const { notifySocketServer } = await Promise.resolve().then(() => __importStar(require('../lib/socket')));
            notifySocketServer('haylander-chat-updates', {
                chatId: (0, utils_1.toWhatsAppJid)(phone),
                fromMe: true,
                message: { conversation: `[Midia enviada: ${fileName}]` },
                id: `msg-${Date.now()}`,
                messageTimestamp: Math.floor(Date.now() / 1000)
            }).catch(() => { });
        }
        catch (e) { }
        return JSON.stringify({ status: 'sent', message: `Arquivo ${fileName} enviado.`, evolution_log: evoLog });
    }
    catch (error) {
        log.error(`sendMedia error ${keyOrUrl}:`, error);
        return JSON.stringify({ status: 'error', message: `Erro ao enviar arquivo: ${String(error)}` });
    }
}
async function sendCommercialPresentation(phone, type = 'apc') {
    const jid = (0, utils_1.toWhatsAppJid)(phone);
    const defaultApc = 'https://pub-9bcc48f0ec304eabbad08c9e3dec23de.r2.dev/apc%20haylander.pdf';
    const defaultVideo = 'https://pub-9bcc48f0ec304eabbad08c9e3dec23de.r2.dev/0915.mp4';
    let mediaUrl = type === 'apc' ? defaultApc : defaultVideo;
    try {
        const settingKey = type === 'apc' ? 'apresentacao_comercial' : 'video_ecac';
        const res = await db_1.default.query('SELECT value FROM system_settings WHERE key = $1', [settingKey]);
        if (res.rows.length > 0 && res.rows[0].value)
            mediaUrl = res.rows[0].value;
    }
    catch { /* usa default */ }
    try {
        if (type === 'apc') {
            const evoLog = await (0, evolution_1.evolutionSendMediaMessage)(jid, mediaUrl, 'document', 'Apresentação Comercial Haylander', 'Apresentacao_Haylander.pdf', 'application/pdf');
            log.info(`[sendCommercialPresentation] Evolution response (APC) for ${phone}:`, { evolution_log: evoLog });
            try {
                const { notifySocketServer } = await Promise.resolve().then(() => __importStar(require('../lib/socket')));
                notifySocketServer('haylander-chat-updates', {
                    chatId: jid,
                    fromMe: true,
                    message: { conversation: `[Apresentação Comercial enviada]` },
                    id: `msg-${Date.now()}`,
                    messageTimestamp: Math.floor(Date.now() / 1000)
                }).catch(() => { });
            }
            catch (e) { }
            return JSON.stringify({ status: 'sent', message: 'Apresentação comercial enviada (PDF).', type, evolution_log: evoLog });
        }
        else {
            const evoLog = await (0, evolution_1.evolutionSendMediaMessage)(jid, mediaUrl, 'video', 'Vídeo Tutorial', 'tutorial.mp4', 'video/mp4');
            log.info(`[sendCommercialPresentation] Evolution response (Video) for ${phone}:`, { evolution_log: evoLog });
            try {
                const { notifySocketServer } = await Promise.resolve().then(() => __importStar(require('../lib/socket')));
                notifySocketServer('haylander-chat-updates', {
                    chatId: jid,
                    fromMe: true,
                    message: { conversation: `[Vídeo Tutorial enviado]` },
                    id: `msg-${Date.now()}`,
                    messageTimestamp: Math.floor(Date.now() / 1000)
                }).catch(() => { });
            }
            catch (e) { }
            return JSON.stringify({ status: 'sent', message: 'Vídeo tutorial enviado.', type, evolution_log: evoLog });
        }
    }
    catch (error) {
        log.error(`sendCommercialPresentation error ${type}:`, error);
        return JSON.stringify({ status: 'error', message: `Erro ao enviar ${type}: ${String(error)}` });
    }
}
// ==================== Serpro ====================
async function checkCnpjSerpro(cnpj, service = 'CCMEI_DADOS', options = {}) {
    try {
        log.info(`[checkCnpjSerpro] Solicitando serviço ${service} para CNPJ ${cnpj}...`);
        const result = await (0, serpro_1.consultarServico)(service, cnpj, options);
        (0, serpro_db_1.saveConsultation)(cnpj, service, result, 200).catch(err => log.error('[checkCnpjSerpro] Error saving:', err));
        (0, serpro_db_1.maybeSavePdfFromBotResult)(cnpj, service, result, options.protocoloRelatorio).catch(err => log.error('[checkCnpjSerpro] Error saving PDF to R2:', err));
        // Se o status é 200, significa que temos conexão/procuração ativa.
        try {
            const cleanCnpj = cnpj.replace(/\D/g, '');
            const resLead = await db_1.default.query("SELECT id AS lead_id FROM leads WHERE REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') = $1 LIMIT 1", [cleanCnpj]);
            if (resLead.rows.length > 0) {
                await markProcuracaoCompleted(resLead.rows[0].lead_id);
                log.info(`[checkCnpjSerpro] Status de procuração sincronizado para CNPJ ${cleanCnpj}`);
            }
        }
        catch (syncErr) {
            log.error('[checkCnpjSerpro] Erro ao sincronizar status de procuração:', syncErr);
        }
        return JSON.stringify(result);
    }
    catch (error) {
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
async function consultarProcuracaoSerpro(cnpj) {
    return checkCnpjSerpro(cnpj, 'PROCURACAO');
}
async function consultarDividaAtivaGeralSerpro(cnpj) {
    return checkCnpjSerpro(cnpj, 'PGFN_CONSULTAR');
}
// ==================== Interpreter (Memory) ====================
async function interpreter(phone, action, text, category = 'atendimento') {
    const redisKey = `interpreter_memory:${phone}`;
    try {
        if (action === 'post') {
            const truncatedText = text.substring(0, 1000);
            const embedding = await (0, embedding_1.generateEmbedding)(truncatedText);
            try {
                const memoryObj = { content: truncatedText, category, embedding: embedding || [], created_at: new Date().toISOString() };
                await redis_1.default.lpush(redisKey, JSON.stringify(memoryObj));
                await redis_1.default.ltrim(redisKey, 0, 49);
            }
            catch (err) {
                log.error('Redis write error:', err);
            }
            if (embedding && embedding.length > 0) {
                try {
                    await (0, db_2.query)(`INSERT INTO interpreter_memories (phone, content, category, embedding) VALUES ($1, $2, $3, $4::vector)`, [phone, truncatedText, category, JSON.stringify(embedding)]);
                }
                catch {
                    await (0, db_2.query)(`INSERT INTO interpreter_memories (phone, content, category) VALUES ($1, $2, $3)`, [phone, truncatedText, category]);
                }
            }
            else {
                await (0, db_2.query)(`INSERT INTO interpreter_memories (phone, content, category) VALUES ($1, $2, $3)`, [phone, truncatedText, category]);
            }
            return JSON.stringify({ status: 'stored', message: 'Memória armazenada com sucesso.' });
        }
        else {
            // GET
            const embedding = await (0, embedding_1.generateEmbedding)(text);
            let rows = [];
            try {
                const rawMemories = await redis_1.default.lrange(redisKey, 0, -1);
                if (rawMemories.length > 0) {
                    const memories = rawMemories.map(m => JSON.parse(m));
                    if (embedding && embedding.length > 0) {
                        const scored = memories.map(m => ({ ...m, similarity: (m.embedding && m.embedding.length > 0) ? (0, utils_1.cosineSimilarity)(embedding, m.embedding) : 0 }));
                        scored.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
                        rows = scored.slice(0, 5);
                    }
                    else {
                        rows = memories.slice(0, 5);
                    }
                }
            }
            catch (err) {
                log.error('Redis read error:', err);
            }
            if (rows.length === 0) {
                if (embedding && embedding.length > 0) {
                    try {
                        const res = await (0, db_2.query)(`
              SELECT content, category, created_at, 1 - (embedding <=> $1::vector) as similarity
              FROM interpreter_memories WHERE phone = $2 ORDER BY similarity DESC LIMIT 5
            `, [JSON.stringify(embedding), phone]);
                        rows = res.rows;
                    }
                    catch {
                        const res = await (0, db_2.query)(`
              SELECT content, category, created_at FROM interpreter_memories
              WHERE phone = $1 AND content ILIKE $2 ORDER BY created_at DESC LIMIT 5
            `, [phone, `%${text}%`]);
                        rows = res.rows;
                    }
                }
                else {
                    const res = await (0, db_2.query)(`
            SELECT content, category, created_at FROM interpreter_memories
            WHERE phone = $1 ORDER BY created_at DESC LIMIT 5
          `, [phone]);
                    rows = res.rows;
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
    }
    catch (error) {
        log.error('Interpreter error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
// ==================== Tracking ====================
// Registra um recurso entregue no JSONB recursos_entregues de leads_processo
async function trackResourceDelivery(leadId, resourceType, resourceKey, metadata) {
    try {
        const entry = {
            delivered_at: new Date().toISOString(),
            status: 'delivered',
            ...(metadata || {}),
        };
        await (0, db_2.query)(`
            INSERT INTO leads_processo (lead_id, recursos_entregues)
            VALUES ($1, $2::jsonb)
            ON CONFLICT (lead_id) DO UPDATE SET
                recursos_entregues = leads_processo.recursos_entregues || $2::jsonb,
                updated_at = NOW()
        `, [leadId, JSON.stringify({ [`${resourceType}:${resourceKey}`]: entry })]);
    }
    catch (error) {
        log.error('trackResourceDelivery error:', error);
    }
}
// Verifica se a procuração foi confirmada via leads_processo (fonte única de verdade)
async function checkProcuracaoStatus(leadId) {
    try {
        const result = await (0, db_2.query)(`
            SELECT procuracao_ativa FROM leads_processo
            WHERE lead_id = $1 AND procuracao_ativa = true
            LIMIT 1
        `, [leadId]);
        return result.rows.length > 0;
    }
    catch (error) {
        log.error('checkProcuracaoStatus error:', error);
        return false;
    }
}
// Marca procuração como confirmada — única escrita, em leads_processo
async function markProcuracaoCompleted(leadId) {
    try {
        const validoAte = new Date(Date.now() + 365 * 86_400_000).toISOString().split('T')[0];
        const recursoEntry = {
            'video-tutorial:video-tutorial-procuracao-ecac': {
                delivered_at: new Date().toISOString(),
                accessed_at: new Date().toISOString(),
                status: 'completed',
            },
        };
        await (0, db_2.query)(`
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
    }
    catch (error) {
        log.error('markProcuracaoCompleted error:', error);
    }
}
async function sendMessageSegment(phone, segment) {
    try {
        switch (segment.type) {
            case 'text':
                await (0, evolution_1.evolutionSendTextMessage)((0, utils_1.toWhatsAppJid)(phone), segment.content);
                break;
            case 'link':
                await (0, evolution_1.evolutionSendTextMessage)((0, utils_1.toWhatsAppJid)(phone), segment.content);
                if (segment.metadata?.url)
                    await (0, evolution_1.evolutionSendTextMessage)((0, utils_1.toWhatsAppJid)(phone), String(segment.metadata.url));
                break;
            case 'media':
                if (segment.metadata?.mediaKey)
                    await sendMedia(phone, String(segment.metadata.mediaKey));
                break;
        }
        try {
            const { addToHistory } = await Promise.resolve().then(() => __importStar(require('../lib/chat-history')));
            let historyText = segment.content;
            if (segment.type === 'link' && segment.metadata?.url)
                historyText += '\n' + segment.metadata.url;
            if (segment.type === 'media')
                historyText = `[Midia: ${segment.metadata?.mediaKey || 'arquivo'}]`;
            await addToHistory(phone, 'assistant', historyText);
            const { notifySocketServer } = await Promise.resolve().then(() => __importStar(require('../lib/socket')));
            let contentText = segment.content;
            if (segment.type === 'link' && segment.metadata?.url)
                contentText += '\n' + segment.metadata.url;
            notifySocketServer('haylander-chat-updates', {
                chatId: (0, utils_1.toWhatsAppJid)(phone),
                fromMe: true,
                message: { conversation: segment.type === 'media' ? `[Midia enviada]` : contentText },
                id: `msg-${Date.now()}`,
                messageTimestamp: Math.floor(Date.now() / 1000)
            }).catch(() => { });
        }
        catch (e) { }
        log.info(`[MessageSegment] Sent: ${segment.id} to ${phone}`);
    }
    catch (error) {
        log.error(`[MessageSegment] Error sending ${segment.id}:`, error);
    }
}
async function getUpdatableFields() {
    const tableMappings = {
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
//# sourceMappingURL=server-tools.js.map