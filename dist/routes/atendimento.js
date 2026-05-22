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
            const instanceRes = await db_1.evolutionPool.query(`SELECT id FROM "Instance" WHERE name = $1 LIMIT 1`, [instanceName]);
            const instanceId = instanceRes.rows[0]?.id;
            if (instanceId) {
                // Query 1: Evolution DB (systembots) — contacts + last message
                const chatsQuery = await db_1.evolutionPool.query(`
          SELECT
            c."remoteJid" as id,
            c."remoteJid" as "remoteJid",
            COALESCE(c."pushName", ch.name) as "pushName",
            c."profilePicUrl",
            COALESCE(ch."unreadMessages", 0) as "unreadCount",
            m.message, m.key, m."messageTimestamp"
          FROM "Contact" c
          LEFT JOIN "Chat" ch ON c."remoteJid" = ch."remoteJid" AND c."instanceId" = ch."instanceId"
          INNER JOIN LATERAL (
            SELECT message, "messageTimestamp", key
            FROM "Message"
            WHERE "instanceId" = c."instanceId"
              AND (
                key->>'remoteJid' = c."remoteJid"
                OR key->>'remoteJidAlt' = c."remoteJid"
              )
            ORDER BY "messageTimestamp" DESC LIMIT 1
          ) m ON true
          WHERE c."instanceId" = $1 AND c."remoteJid" NOT LIKE '%@lid'
          ORDER BY m."messageTimestamp" DESC NULLS LAST LIMIT 300
        `, [instanceId]);
                // Query 2: App DB (n_db_pg) — lead names/status keyed by normalized phone
                const phones = chatsQuery.rows
                    .map((c) => String(c.remoteJid || '').split('@')[0].replace(/\D/g, ''))
                    .filter(Boolean);
                // Build leadMap keyed by all normalized variants so format differences don't break lookup
                const leadMap = new Map();
                if (phones.length > 0) {
                    const { rows: leadRows } = await db_1.default.query(`SELECT l.id, l.telefone, l.nome_completo, lp.status_atendimento, lp.data_reuniao
             FROM leads l LEFT JOIN leads_processo lp ON lp.lead_id = l.id
             WHERE REGEXP_REPLACE(l.telefone, '[^0-9]', '', 'g') = ANY($1::text[])
                OR '55' || REGEXP_REPLACE(l.telefone, '[^0-9]', '', 'g') = ANY($1::text[])
                OR REGEXP_REPLACE(REGEXP_REPLACE(l.telefone, '[^0-9]', '', 'g'), '^55', '') = ANY($1::text[])`, [phones]).catch(() => ({ rows: [] }));
                    for (const r of leadRows) {
                        const clean = String(r.telefone).replace(/\D/g, '');
                        leadMap.set(clean, r);
                        leadMap.set(`55${clean}`, r);
                        leadMap.set(clean.replace(/^55/, ''), r);
                    }
                }
                chatsArray = chatsQuery.rows.map((c) => {
                    const phone = String(c.remoteJid || '').split('@')[0].replace(/\D/g, '');
                    const lead = leadMap.get(phone);
                    return {
                        ...c,
                        leadName: lead?.nome_completo || c.pushName || null,
                        leadId: lead?.id || null,
                        isRegistered: !!lead?.id,
                        leadStatus: lead?.status_atendimento || null,
                        leadDataReuniao: lead?.data_reuniao || null,
                    };
                });
            }
        }
        catch {
            // Fallback: REST API — enrich chats with contact names from findContacts
            const [fallbackChats, contacts] = await Promise.all([
                (0, evolution_1.evolutionFindChats)().catch(() => []),
                (0, evolution_1.evolutionFindContacts)().catch(() => []),
            ]);
            const contactMap = new Map(contacts.map(c => [c.remoteJid, c]));
            const rawChats = Array.isArray(fallbackChats) ? fallbackChats : [];
            // Enrich with lead data so isRegistered is correct
            const fallbackPhones = rawChats
                .map((c) => String(c.remoteJid || c.id || '').split('@')[0].replace(/\D/g, ''))
                .filter(Boolean);
            const fallbackLeadMap = new Map();
            if (fallbackPhones.length > 0) {
                const { rows: leadRows } = await db_1.default.query(`SELECT l.id, l.telefone, l.nome_completo, lp.status_atendimento, lp.data_reuniao
           FROM leads l LEFT JOIN leads_processo lp ON lp.lead_id = l.id
           WHERE REGEXP_REPLACE(l.telefone, '[^0-9]', '', 'g') = ANY($1::text[])
              OR '55' || REGEXP_REPLACE(l.telefone, '[^0-9]', '', 'g') = ANY($1::text[])
              OR REGEXP_REPLACE(REGEXP_REPLACE(l.telefone, '[^0-9]', '', 'g'), '^55', '') = ANY($1::text[])`, [fallbackPhones]).catch(() => ({ rows: [] }));
                for (const r of leadRows) {
                    const clean = String(r.telefone).replace(/\D/g, '');
                    fallbackLeadMap.set(clean, r);
                    fallbackLeadMap.set(`55${clean}`, r);
                    fallbackLeadMap.set(clean.replace(/^55/, ''), r);
                }
            }
            chatsArray = rawChats.map(c => {
                const jid = String(c.remoteJid || c.id || '');
                const phone = jid.split('@')[0].replace(/\D/g, '');
                const contact = contactMap.get(jid);
                const lead = fallbackLeadMap.get(phone);
                return {
                    ...c,
                    pushName: contact?.pushName || c.pushName || null,
                    profilePicUrl: contact?.profilePicUrl || c.profilePicUrl || null,
                    leadName: lead?.nome_completo || contact?.pushName || c.pushName || null,
                    leadId: lead?.id || null,
                    isRegistered: !!lead?.id,
                    leadStatus: lead?.status_atendimento || null,
                    leadDataReuniao: lead?.data_reuniao || null,
                };
            });
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
        res.json({ success: true, url: data?.profilePictureUrl || data?.pictureUrl || data?.url || null });
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
      SELECT
        l.id, l.telefone, l.nome_completo, l.email, l.cpf, l.data_nascimento, l.nome_mae, l.sexo,
        l.cnpj, l.razao_social, l.nome_fantasia, l.tipo_negocio, l.faturamento_mensal,
        l.endereco, l.numero, l.complemento, l.bairro, l.cidade, l.estado, l.cep,
        l.situacao, l.qualificacao, l.motivo_qualificacao, l.interesse_ajuda,
        l.pos_qualificacao, l.possui_socio, l.confirmacao_qualificacao,
        l.tem_divida, l.tipo_divida, l.valor_divida_municipal, l.valor_divida_estadual,
        l.valor_divida_federal, l.valor_divida_pgfn, l.valor_divida_pgfn AS valor_divida_ativa,
        l.tempo_divida, l.calculo_parcelamento,
        l.needs_attendant, l.attendant_requested_at, l.metadata, l.data_cadastro, l.atualizado_em,
        CASE WHEN l.senha_gov_enc IS NULL THEN NULL
             ELSE pgp_sym_decrypt(l.senha_gov_enc::bytea, $2::text)
        END AS senha_gov,
        lp.servico, lp.servico AS servico_negociado, lp.servico AS servico_escolhido,
        lp.status_atendimento, lp.data_reuniao,
        (lp.data_reuniao IS NOT NULL) AS reuniao_agendada,
        lp.procuracao, lp.procuracao_ativa, lp.procuracao_validade, lp.cliente,
        lp.atendente_id, lp.envio_disparo, lp.observacoes,
        lp.data_controle_24h, lp.data_followup, lp.recursos_entregues,
        -- Legacy UI fields (not stored separately, but expected by LeadSheetData)
        NULL::text AS cartao_cnpj,
        NULL::text AS porte_empresa,
        NULL::text AS score_serasa,
        NULL::text AS tem_cartorios,
        NULL::text AS motivo_divida,
        NULL::text AS tem_protestos,
        NULL::text AS tem_divida_ativa,
        NULL::text AS tem_execucao_fiscal,
        NULL::text AS tem_parcelamento,
        NULL::text AS parcelamento_ativo,
        NULL::text AS idades_socios,
        NULL::timestamptz AS data_ultima_consulta
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
            attendant_requested_at: toIso(lead.attendant_requested_at),
            data_followup: toIso(lead.data_followup),
        };
        res.json({ success: true, data: serialized });
    }
    catch (err) {
        console.error('[atendimento/lead] error:', err);
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
    const limit = 50;
    try {
        // Expand JID set: phone→LID (incoming msgs stored under @lid in key.remoteJid)
        // key.remoteJidAlt stores the phone JID for incoming LID messages
        const jidsWithLids = new Set(jids);
        if (jids.length > 0) {
            const params = jids.map((_, i) => `$${i + 1}`).join(',');
            const { rows } = await db_1.evolutionPool.query(`SELECT DISTINCT key->>'remoteJid' as lid FROM "Message"
         WHERE key->>'remoteJidAlt' = ANY(ARRAY[${params}])
           AND key->>'remoteJid' LIKE '%@lid'`, jids).catch(() => ({ rows: [] }));
            for (const row of rows) {
                if (row.lid)
                    jidsWithLids.add(row.lid);
            }
        }
        let allRecords = [];
        for (const singleJid of Array.from(jidsWithLids)) {
            try {
                const response = await (0, evolution_1.evolutionFindMessages)(singleJid, limit, page);
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
        // If Evolution API returned nothing, try direct DB query on systembots as fallback
        if (records.length === 0) {
            const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'teste';
            const instanceRes = await db_1.evolutionPool.query(`SELECT id FROM "Instance" WHERE name = $1 LIMIT 1`, [instanceName]).catch(() => ({ rows: [] }));
            const instanceId = instanceRes.rows[0]?.id;
            if (instanceId) {
                const allJids = Array.from(jidsWithLids);
                const placeholders = allJids.map((_, i) => `$${i + 1}`).join(',');
                const offset = (page - 1) * limit;
                const { rows: dbRows } = await db_1.evolutionPool.query(`SELECT key, message, "messageTimestamp" FROM "Message"
           WHERE "instanceId" = $${allJids.length + 1}
             AND (key->>'remoteJid' = ANY(ARRAY[${placeholders}]) OR key->>'remoteJidAlt' = ANY(ARRAY[${placeholders}]))
             AND message IS NOT NULL
           ORDER BY "messageTimestamp" DESC LIMIT ${limit} OFFSET ${offset}`, [...allJids, instanceId]).catch(() => ({ rows: [] }));
                for (const r of dbRows) {
                    const keyObj = (typeof r.key === 'object' ? r.key : {});
                    const msgId = String(keyObj?.id || '');
                    if (msgId && !uniqueMap.has(msgId)) {
                        uniqueMap.set(msgId, { key: keyObj, message: r.message, messageTimestamp: Number(r.messageTimestamp) });
                    }
                }
                records = Array.from(uniqueMap.values());
                records.sort((a, b) => Number(b.messageTimestamp || 0) - Number(a.messageTimestamp || 0));
            }
        }
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
        console.error('[messages] error:', err);
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