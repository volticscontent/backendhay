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
        const { telefone, ...fields } = data;
        if (!telefone)
            return JSON.stringify({ status: 'error', message: 'Telefone is required' });
        const resId = await (0, db_2.query)('SELECT id FROM leads WHERE telefone = $1 LIMIT 1', [telefone]);
        if (resId.rows.length === 0)
            return JSON.stringify({ status: 'not_found', message: 'Usuário não encontrado' });
        const leadId = resId.rows[0].id;
        let updatedData = {};
        const tableMappings = {
            leads: ['nome_completo', 'email', 'cpf', 'data_nascimento', 'nome_mae', 'senha_gov'],
            leads_empresarial: ['cnpj', 'razao_social', 'nome_fantasia', 'tipo_negocio', 'faturamento_mensal', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep', 'cartao_cnpj'],
            leads_qualificacao: ['situacao', 'qualificacao', 'motivo_qualificacao', 'interesse_ajuda', 'pos_qualificacao', 'possui_socio', 'confirmacao_qualificacao'],
            leads_financeiro: ['tem_divida', 'tipo_divida', 'valor_divida_municipal', 'valor_divida_estadual', 'valor_divida_federal', 'valor_divida_ativa', 'tempo_divida', 'calculo_parcelamento'],
            leads_vendas: ['servico_negociado', 'status_atendimento', 'data_reuniao', 'procuracao', 'procuracao_ativa', 'procuracao_validade', 'servico_escolhido', 'reuniao_agendada', 'vendido'],
            leads_atendimento: ['atendente_id', 'envio_disparo', 'observacoes']
        };
        for (const [tableName, validFields] of Object.entries(tableMappings)) {
            const updateFields = [];
            const values = [];
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
                    const updateRes = await (0, db_2.query)(`UPDATE leads SET ${updateFields.join(', ')}, atualizado_em = NOW() WHERE telefone = $${i} RETURNING *`, values);
                    if (updateRes.rows.length > 0) {
                        updatedData = { ...updatedData, ...updateRes.rows[0] };
                    }
                }
            }
            else {
                for (const field of validFields) {
                    if (fields[field] !== undefined) {
                        if (tableName === 'leads_atendimento' && field === 'observacoes') {
                            updateFields.push(`${field} = CASE WHEN ${field} IS NULL OR ${field} = '' THEN $${i} ELSE ${field} || E'\\n' || $${i} END`);
                        }
                        else {
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
                    const check = await (0, db_2.query)(`SELECT id FROM ${tableName} WHERE lead_id = $1`, [leadId]);
                    if (check.rows.length > 0) {
                        values.push(leadId);
                        await (0, db_2.query)(`UPDATE ${tableName} SET ${updateFields.join(', ')}, updated_at = NOW() WHERE lead_id = $${i}`, values);
                        updatedData = { ...updatedData, ...fields };
                    }
                    else {
                        const insertCols = ['lead_id'];
                        const insertVals = [leadId];
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
                        await (0, db_2.query)(`INSERT INTO ${tableName} (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`, insertVals);
                        updatedData = { ...updatedData, ...fields };
                    }
                }
            }
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
        const res = await (0, db_2.query)(`SELECT l.nome_completo FROM leads l JOIN leads_vendas lv ON l.id = lv.lead_id WHERE lv.data_reuniao = $1`, [parsedDate]);
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
        await (0, db_2.query)(`INSERT INTO leads_vendas (lead_id) VALUES ($1) ON CONFLICT (lead_id) DO NOTHING`, [leadId]);
        const parsedDate = parseDateStr(dateStr);
        if (!parsedDate)
            return JSON.stringify({ status: 'error', message: 'Data inválida.' });
        await (0, db_2.query)(`UPDATE leads_vendas SET data_reuniao = $1 WHERE lead_id = $2`, [parsedDate, leadId]);
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
    return JSON.stringify({ link, message: `Formulário gerado com sucesso. O link é: ${link}. Envie este link EXATO para o cliente.` });
}
async function sendMeetingForm(phone) {
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://haylanderform.vercel.app';
    if (baseUrl.includes('loca.lt') || baseUrl.includes('ngrok-free.app')) {
        baseUrl = 'https://haylanderform.vercel.app';
    }
    baseUrl = baseUrl.replace(/\/$/, '');
    const link = `${baseUrl}/reuniao/${phone}`;
    return JSON.stringify({ link, message: `Link de agendamento gerado: ${link}. Envie ao cliente.` });
}
async function sendEnumeratedList(phone) {
    const listText = `Olá! 👋 Como posso te ajudar? Escolha uma opção:\n\n1️⃣ Regularização MEI\n2️⃣ Abertura de MEI\n3️⃣ Falar com atendente\n4️⃣ Informações sobre os serviços\n5️⃣ Sair do atendimento`;
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
        await (0, db_2.query)(`UPDATE leads SET needs_attendant = true, attendant_requested_at = NOW() WHERE telefone = $1`, [phone]);
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
            const text = `🔔 *Solicitação de Atendimento*\n\nCliente *${phone}* solicitou atendente.\n📝 *Motivo:* ${reason}\n🔗 https://wa.me/${phone.replace(/\D/g, '')}`;
            const evoLog = await (0, evolution_1.evolutionSendTextMessage)((0, utils_1.toWhatsAppJid)(attendantNumber), text);
            log.info(`[callAttendant] Evolution response for notifying attendant (${attendantNumber}):`, { evolution_log: evoLog });
            return JSON.stringify({ status: 'success', message: 'Atendente notificado. Aguarde um momento.', evolution_log: evoLog });
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
        const res = await (0, db_2.query)('SELECT nome as name, descricao as description, price_info FROM services WHERE active = true AND nome ILIKE $1', [`%${searchQuery}%`]);
        if (res.rows.length > 0)
            return JSON.stringify(res.rows);
        const all = await (0, db_2.query)('SELECT nome as name, descricao as description, price_info FROM services WHERE active = true');
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
async function checkCnpjSerpro(cnpj, service = 'CCMEI_DADOS') {
    try {
        const result = await (0, serpro_1.consultarServico)(service, cnpj);
        (0, serpro_db_1.saveConsultation)(cnpj, service, result, 200).catch(err => log.error('[checkCnpjSerpro] Error saving:', err));
        return JSON.stringify(result);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ status: 'error', message: errorMessage });
    }
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
async function trackResourceDelivery(leadId, resourceType, resourceKey, metadata) {
    try {
        await (0, db_2.query)(`
      INSERT INTO resource_tracking (lead_id, resource_type, resource_key, delivered_at, status, metadata)
      VALUES ($1, $2, $3, NOW(), 'delivered', $4)
    `, [leadId, resourceType, resourceKey, JSON.stringify(metadata || {})]);
    }
    catch (error) {
        log.error('trackResourceDelivery error:', error);
    }
}
async function checkProcuracaoStatus(leadId) {
    try {
        const result = await (0, db_2.query)(`
      SELECT status FROM resource_tracking
      WHERE lead_id = $1 AND resource_type = 'video-tutorial' AND resource_key = 'video-tutorial-procuracao-ecac'
      ORDER BY delivered_at DESC LIMIT 1
    `, [leadId]);
        return result.rows.length > 0 && result.rows[0].status === 'completed';
    }
    catch (error) {
        log.error('checkProcuracaoStatus error:', error);
        return false;
    }
}
async function markProcuracaoCompleted(leadId) {
    try {
        await (0, db_2.query)(`
      UPDATE resource_tracking SET status = 'completed', accessed_at = NOW()
      WHERE lead_id = $1 AND resource_type = 'video-tutorial' AND resource_key = 'video-tutorial-procuracao-ecac'
    `, [leadId]);
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
//# sourceMappingURL=server-tools.js.map