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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importStar(require("../lib/db"));
const evolution_1 = require("../lib/evolution");
const router = (0, express_1.Router)();
// GET /atendimento/chats
router.get('/atendimento/chats', async (_req, res) => {
    try {
        let chatsArray = [];
        try {
            const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'teste';
            const instanceRes = await db_1.default.query(`SELECT id FROM "Instance" WHERE name = $1 LIMIT 1`, [instanceName]);
            const instanceId = instanceRes.rows[0]?.id;
            if (instanceId) {
                const chatsQuery = await db_1.default.query(`
          SELECT c."remoteJid" as id, c."remoteJid" as "remoteJid", c."pushName", c."profilePicUrl",
            ch."unreadMessages" as "unreadCount", m."message", m.key, m."messageTimestamp"
          FROM "Contact" c
          INNER JOIN "Chat" ch ON c."remoteJid" = ch."remoteJid" AND c."instanceId" = ch."instanceId"
          LEFT JOIN LATERAL (
            SELECT "message", "messageTimestamp", "key"
            FROM "Message"
            WHERE "remoteJid" = c."remoteJid" AND "instanceId" = c."instanceId"
            ORDER BY "messageTimestamp" DESC LIMIT 1
          ) m ON true
          WHERE c."instanceId" = $1 AND c."remoteJid" NOT LIKE '%@lid'
          ORDER BY m."messageTimestamp" DESC NULLS LAST LIMIT 300
        `, [instanceId]);
                chatsArray = chatsQuery.rows;
            }
        }
        catch {
            const fallback = await (0, evolution_1.evolutionFindChats)();
            chatsArray = Array.isArray(fallback) ? fallback : [];
        }
        chatsArray = chatsArray.filter((c) => !String(c.remoteJid || c.id || '').includes('@lid'));
        res.json({ success: true, data: chatsArray });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch chats' });
    }
});
// GET /atendimento/profile-pic?jid=...
router.get('/atendimento/profile-pic', async (req, res) => {
    const jid = req.query.jid;
    if (!jid)
        return void res.status(400).json({ success: false });
    try {
        const url = await (0, evolution_1.evolutionGetProfilePic)(jid.split('@')[0]);
        const data = url;
        res.json({ success: true, url: data?.profilePictureUrl || null });
    }
    catch {
        res.json({ success: false, url: null });
    }
});
// GET /atendimento/lead/:phone
router.get('/atendimento/lead/:phone', async (req, res) => {
    const cleanPhone = String(req.params.phone).replace(/\D/g, '');
    try {
        const cryptoKey = process.env.PGCRYPTO_KEY ?? '';
        const baseQuery = `
      SELECT l.*,
        CASE WHEN l.senha_gov_enc IS NULL THEN NULL
             ELSE pgp_sym_decrypt(l.senha_gov_enc::bytea, $2::text)
        END AS senha_gov,
        l.valor_divida_pgfn AS valor_divida_ativa,
        lp.servico, lp.servico AS servico_negociado, lp.servico AS servico_escolhido, lp.status_atendimento, lp.data_reuniao,
        (lp.data_reuniao IS NOT NULL) AS reuniao_agendada,
        lp.procuracao, lp.procuracao_ativa, lp.procuracao_validade,
        lp.observacoes, lp.data_controle_24h, lp.envio_disparo, lp.atendente_id,
        lp.data_followup, lp.recursos_entregues
      FROM leads l
      LEFT JOIN leads_processo lp ON l.id = lp.lead_id
    `;
        let result = await (0, db_1.query)(`${baseQuery} WHERE l.telefone = $1`, [cleanPhone, cryptoKey]);
        if (result.rows.length === 0) {
            const phoneVariations = [cleanPhone, cleanPhone.replace(/^55/, ''), `55${cleanPhone}`].filter(Boolean);
            result = await (0, db_1.query)(`${baseQuery} WHERE l.telefone = ANY($1) LIMIT 1`, [phoneVariations, cryptoKey]);
        }
        if (result.rows.length === 0)
            return void res.status(404).json({ success: false, error: 'Lead não encontrado' });
        const lead = result.rows[0];
        const toIso = (v) => (v ? new Date(v).toISOString() : null);
        const serialized = {
            ...lead,
            data_cadastro: toIso(lead.data_cadastro),
            atualizado_em: toIso(lead.atualizado_em),
            data_controle_24h: toIso(lead.data_controle_24h),
            data_reuniao: toIso(lead.data_reuniao),
            procuracao_validade: toIso(lead.procuracao_validade),
        };
        res.json({ success: true, data: serialized });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch lead' });
    }
});
// POST /atendimento/leads/register
router.post('/atendimento/leads/register', async (req, res) => {
    const { name, phone } = req.body;
    const cleanPhone = (phone || '').replace(/\D/g, '');
    try {
        const existing = await (0, db_1.query)('SELECT id FROM leads WHERE telefone = $1', [cleanPhone]);
        if (existing.rows.length > 0)
            return void res.status(409).json({ success: false, error: 'Usuário já cadastrado' });
        const result = await (0, db_1.query)('INSERT INTO leads (nome_completo, telefone, data_cadastro) VALUES ($1,$2,NOW()) RETURNING id', [name, cleanPhone]);
        res.json({ success: true, data: result.rows[0] });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Falha ao cadastrar' });
    }
});
// POST /atendimento/leads/mass-register
router.post('/atendimento/leads/mass-register', async (req, res) => {
    const { leads } = req.body;
    try {
        const count = await (0, db_1.withClient)(async (client) => {
            await client.query('BEGIN');
            let inserted = 0;
            for (const lead of leads || []) {
                const clean = lead.phone.replace(/\D/g, '');
                const { rows: existing } = await client.query('SELECT id FROM leads WHERE telefone = $1', [clean]);
                if (existing.length > 0)
                    continue;
                await client.query('INSERT INTO leads (nome_completo, telefone, data_cadastro) VALUES ($1,$2,NOW())', [lead.name, clean]);
                inserted++;
            }
            await client.query('COMMIT');
            return inserted;
        });
        res.json({ success: true, count });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Falha no cadastro em massa' });
    }
});
// GET /atendimento/consultations/:cnpj
router.get('/atendimento/consultations/:cnpj', async (req, res) => {
    const cleanCnpj = String(req.params.cnpj).replace(/\D/g, '');
    try {
        const result = await (0, db_1.query)(`SELECT id, cnpj, tipo_servico, resultado, status, created_at FROM consultas_serpro WHERE cnpj=$1 ORDER BY created_at DESC`, [cleanCnpj]);
        const data = result.rows.map((r) => ({ ...r, created_at: r.created_at ? new Date(r.created_at).toISOString() : null }));
        res.json({ success: true, data });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Falha ao buscar consultas' });
    }
});
// GET /atendimento/messages?jid=...&page=...
router.get('/atendimento/messages', async (req, res) => {
    const jid = req.query.jid;
    const page = parseInt(String(req.query.page || '1'), 10);
    if (!jid)
        return void res.status(400).json({ success: false, error: 'jid é obrigatório' });
    const jids = jid.split(',').filter(Boolean);
    const jidsWithLids = new Set(jids);
    try {
        if (jids.length > 0) {
            const params = jids.map((_, i) => `$${i + 1}`).join(',');
            const { rows } = await db_1.default.query(`SELECT DISTINCT key->>'remoteJid' as lid FROM "Message" WHERE key->>'remoteJidAlt' = ANY(ARRAY[${params}]) OR key->>'senderPn' = ANY(ARRAY[${params}])`, jids).catch(() => ({ rows: [] }));
            for (const row of rows) {
                if (row.lid)
                    jidsWithLids.add(row.lid);
            }
        }
        let allRecords = [];
        for (const singleJid of Array.from(jidsWithLids)) {
            try {
                const response = await (0, evolution_1.evolutionFindMessages)(singleJid, 50, page);
                const records = (response?.messages?.records || []);
                allRecords = [...allRecords, ...records];
            }
            catch { /* continue */ }
        }
        const uniqueMap = new Map();
        for (const r of allRecords) {
            const id = String(r.key?.id || r.id || '');
            if (id && !uniqueMap.has(id))
                uniqueMap.set(id, r);
        }
        let records = Array.from(uniqueMap.values());
        records.sort((a, b) => Number(b.messageTimestamp || 0) - Number(a.messageTimestamp || 0));
        records = await Promise.all(records.map(async (msg) => {
            const content = (msg.message || msg);
            const hasMedia = content.audioMessage || content.imageMessage || content.videoMessage ||
                content.documentMessage || content.stickerMessage;
            if (hasMedia && !msg.base64) {
                const data = await (0, evolution_1.evolutionGetBase64FromMediaMessage)(msg);
                if (data?.base64)
                    return { ...msg, base64: data.base64 };
            }
            return msg;
        }));
        res.json({ success: true, data: { messages: { records } } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch messages' });
    }
});
// POST /atendimento/send-message
router.post('/atendimento/send-message', async (req, res) => {
    const { jid, text } = req.body;
    if (!jid || !text)
        return void res.status(400).json({ success: false, error: 'jid e text são obrigatórios' });
    try {
        const result = await (0, evolution_1.evolutionSendTextMessage)(jid, text);
        res.json({ success: true, data: result });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to send message' });
    }
});
// POST /atendimento/send-media
router.post('/atendimento/send-media', async (req, res) => {
    const { jid, base64, type, caption, fileName, mimeType, isVoiceNote } = req.body;
    if (!jid || !base64)
        return void res.status(400).json({ success: false, error: 'jid e base64 são obrigatórios' });
    try {
        let result;
        if (isVoiceNote && type === 'audio') {
            result = await (0, evolution_1.evolutionSendWhatsAppAudio)(jid, base64);
        }
        else {
            result = await (0, evolution_1.evolutionSendMediaMessage)(jid, base64, type || 'image', caption || '', fileName || '', mimeType || '');
        }
        res.json({ success: true, data: result });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to send media' });
    }
});
// GET /atendimento/leads/search?term=...
router.get('/atendimento/leads/search', async (req, res) => {
    const term = req.query.term;
    if (!term || term.length < 3)
        return void res.json({ success: true, data: [] });
    const searchTerm = `%${term}%`;
    const cleanTerm = term.replace(/\D/g, '');
    try {
        let sql = `SELECT l.id, l.nome_completo, l.telefone, l.cnpj, l.razao_social, l.nome_fantasia
               FROM leads l
               WHERE l.nome_completo ILIKE $1 OR l.razao_social ILIKE $1 OR l.nome_fantasia ILIKE $1`;
        const params = [searchTerm];
        if (cleanTerm.length > 0) {
            sql += ` OR l.telefone LIKE $2 OR l.cnpj LIKE $2`;
            params.push(`%${cleanTerm}%`);
        }
        sql += ` LIMIT 20`;
        const result = await (0, db_1.query)(sql, params);
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao buscar clientes.' });
    }
});
// POST /atendimento/scheduling/send-link
router.post('/atendimento/scheduling/send-link', async (req, res) => {
    const { phone, link } = req.body;
    if (!phone)
        return void res.status(400).json({ success: false, error: 'Telefone não fornecido.' });
    try {
        const jid = `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
        await (0, evolution_1.evolutionSendTextMessage)(jid, `Olá! Segue o link para agendamento da sua reunião:\n\n${link}\n\nQualquer dúvida, estamos à disposição.`);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao enviar mensagem.' });
    }
});
exports.default = router;
//# sourceMappingURL=atendimento.js.map