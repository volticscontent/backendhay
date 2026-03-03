"use strict";
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
const db_1 = __importDefault(require("../lib/db"));
const db_2 = require("../lib/db");
const redis_1 = __importDefault(require("../lib/redis"));
const utils_1 = require("../lib/utils");
const evolution_1 = require("../lib/evolution");
const embedding_1 = require("./embedding");
const serpro_1 = require("../lib/serpro");
const serpro_db_1 = require("../lib/serpro-db");
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
        console.error('getUser error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
async function createUser(data) {
    try {
        const { nome_completo, telefone } = data;
        const email = data.email || null;
        const res = await (0, db_2.query)(`INSERT INTO leads (nome_completo, telefone, email, data_cadastro) VALUES ($1, $2, $3, NOW()) RETURNING id`, [nome_completo, telefone, email]);
        return JSON.stringify({ status: 'success', id: res.rows[0].id });
    }
    catch (error) {
        console.error('createUser error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
async function updateUser(data) {
    try {
        const { telefone, ...fields } = data;
        if (!telefone)
            return JSON.stringify({ status: 'error', message: 'Telefone is required' });
        const leadsFields = [
            'nome_completo', 'email', 'cpf', 'nome_mae', 'senha_gov', 'situacao', 'observacoes', 'qualificacao',
            'faturamento_mensal', 'tem_divida', 'tipo_negocio', 'possui_socio', 'valor_divida_federal',
            'valor_divida_ativa', 'valor_divida_estadual', 'valor_divida_municipal', 'cartao_cnpj',
            'tipo_divida', 'motivo_qualificacao', 'interesse_ajuda', 'pos_qualificacao', 'cnpj', 'razao_social'
        ];
        const updateFields = [];
        const values = [];
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
            await (0, db_2.query)(`UPDATE leads SET ${updateFields.join(', ')} WHERE telefone = $${i}`, values);
        }
        const resId = await (0, db_2.query)('SELECT id FROM leads WHERE telefone = $1', [telefone]);
        if (resId.rows.length > 0) {
            const leadId = resId.rows[0].id;
            const check = await (0, db_2.query)('SELECT id FROM leads_atendimento WHERE lead_id = $1', [leadId]);
            if (check.rows.length > 0) {
                await (0, db_2.query)('UPDATE leads_atendimento SET data_controle_24h = NOW() WHERE lead_id = $1', [leadId]);
            }
            else {
                await (0, db_2.query)('INSERT INTO leads_atendimento (lead_id, data_controle_24h) VALUES ($1, NOW())', [leadId]);
            }
        }
        return JSON.stringify({ status: 'success', message: 'User updated' });
    }
    catch (error) {
        console.error('updateUser error:', error);
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
        console.error('setAgentRouting error:', error);
        return JSON.stringify({ status: 'error', message: String(error) });
    }
}
async function getAgentRouting(phone) {
    try {
        return await redis_1.default.get(`routing_override:${phone}`);
    }
    catch (error) {
        console.error('getAgentRouting error:', error);
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
        console.error('checkAvailability error:', error);
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
        console.error('scheduleMeeting error:', error);
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
async function sendEnumeratedList() {
    return JSON.stringify({
        message: `1. Regularização\n2. Abertura de MEI\n3. Falar com atendente\n4. Informações sobre os serviços\n5. Sair do atendimento`
    });
}
// ==================== Atendente ====================
async function callAttendant(phone, reason = 'Solicitação do cliente') {
    try {
        await (0, db_2.query)(`UPDATE leads SET needs_attendant = true, attendant_requested_at = NOW() WHERE telefone = $1`, [phone]);
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
            }
            finally {
                clearTimeout(timeoutId);
            }
            return JSON.stringify({ status: 'success', message: 'Atendente notificado. Aguarde um momento.' });
        }
        return JSON.stringify({ status: 'success', message: 'Solicitação registrada. Aguarde um momento.' });
    }
    catch (error) {
        console.error('callAttendant error:', error);
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
        console.error('contextRetrieve error:', error);
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
        console.error('searchServices error:', error);
        return '[]';
    }
}
// ==================== Mídia ====================
async function getAvailableMedia() {
    return JSON.stringify([
        { key: 'apc', description: 'Apresentação Comercial (PDF)', type: 'document' },
        { key: 'video_institucional', description: 'Vídeo Institucional', type: 'video' }
    ]);
}
async function sendMedia(phone, keyOrUrl) {
    if (keyOrUrl === 'apc')
        return sendCommercialPresentation(phone, 'apc');
    if (keyOrUrl === 'video_institucional' || keyOrUrl === 'video')
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
        await (0, evolution_1.evolutionSendMediaMessage)((0, utils_1.toWhatsAppJid)(phone), mediaUrl, mediaType, fileName, fileName, mimetype);
        return JSON.stringify({ status: 'sent', message: `Arquivo ${fileName} enviado.` });
    }
    catch (error) {
        console.error(`sendMedia error ${keyOrUrl}:`, error);
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
            await (0, evolution_1.evolutionSendMediaMessage)(jid, mediaUrl, 'document', 'Apresentação Comercial Haylander', 'Apresentacao_Haylander.pdf', 'application/pdf');
            return JSON.stringify({ status: 'sent', message: 'Apresentação comercial enviada (PDF).', type });
        }
        else {
            await (0, evolution_1.evolutionSendMediaMessage)(jid, mediaUrl, 'video', 'Vídeo Tutorial', 'tutorial.mp4', 'video/mp4');
            return JSON.stringify({ status: 'sent', message: 'Vídeo tutorial enviado.', type });
        }
    }
    catch (error) {
        console.error(`sendCommercialPresentation error ${type}:`, error);
        return JSON.stringify({ status: 'error', message: `Erro ao enviar ${type}: ${String(error)}` });
    }
}
// ==================== Serpro ====================
async function checkCnpjSerpro(cnpj, service = 'CCMEI_DADOS') {
    try {
        const result = await (0, serpro_1.consultarServico)(service, cnpj);
        (0, serpro_db_1.saveConsultation)(cnpj, service, result, 200).catch(err => console.error('[checkCnpjSerpro] Error saving:', err));
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
        // Ensure table exists
        try {
            await (0, db_2.query)(`
        CREATE TABLE IF NOT EXISTS interpreter_memories (
          id SERIAL PRIMARY KEY,
          phone VARCHAR(20) NOT NULL,
          content TEXT NOT NULL,
          category VARCHAR(50),
          embedding vector(1536),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
        }
        catch {
            await (0, db_2.query)(`
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
            const embedding = await (0, embedding_1.generateEmbedding)(truncatedText);
            try {
                const memoryObj = { content: truncatedText, category, embedding: embedding || [], created_at: new Date().toISOString() };
                await redis_1.default.lpush(redisKey, JSON.stringify(memoryObj));
                await redis_1.default.ltrim(redisKey, 0, 49);
            }
            catch (err) {
                console.error('Redis write error:', err);
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
                console.error('Redis read error:', err);
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
        console.error('Interpreter error:', error);
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
        console.error('trackResourceDelivery error:', error);
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
        console.error('checkProcuracaoStatus error:', error);
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
        console.error('markProcuracaoCompleted error:', error);
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
        console.log(`[MessageSegment] Sent: ${segment.id} to ${phone}`);
    }
    catch (error) {
        console.error(`[MessageSegment] Error sending ${segment.id}:`, error);
    }
}
//# sourceMappingURL=server-tools.js.map