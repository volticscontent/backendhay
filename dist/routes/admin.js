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
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = __importStar(require("../lib/db"));
const redis_1 = __importDefault(require("../lib/redis"));
const evolution_1 = require("../lib/evolution");
const router = (0, express_1.Router)();
// ---- GET /dashboard ----
router.get('/dashboard', async (_req, res) => {
    try {
        const result = await (0, db_1.query)(`
      SELECT
        l.id,
        l.nome_completo,
        l.telefone,
        l.email,
        le.cnpj,
        lf.calculo_parcelamento,
        l.data_cadastro,
        l.atualizado_em,
        la.envio_disparo,
        lq.situacao,
        lq.qualificacao,
        lq.interesse_ajuda,
        lq.pos_qualificacao AS confirmacao_qualificacao,
        (lv.data_reuniao IS NOT NULL) AS reuniao_agendada,
        (lv.cliente IS TRUE) AS cliente
      FROM leads l
      LEFT JOIN leads_empresarial le ON l.id = le.lead_id
      LEFT JOIN leads_qualificacao lq ON l.id = lq.lead_id
      LEFT JOIN leads_financeiro lf ON l.id = lf.lead_id
      LEFT JOIN leads_atendimento la ON l.id = la.lead_id
      LEFT JOIN leads_vendas lv ON l.id = lv.lead_id
      ORDER BY l.atualizado_em DESC
      LIMIT 500
    `);
        res.json(result.rows);
    }
    catch (err) {
        console.error('Error fetching dashboard data:', err);
        res.status(500).json({ error: String(err) });
    }
});
// ---- POST /disparos/callback ----
router.post('/disparos/callback', async (req, res) => {
    const { disparo_id, results } = req.body;
    if (!disparo_id || !Array.isArray(results))
        return void res.status(400).json({ error: 'Invalid payload' });
    let successCount = 0;
    let failCount = 0;
    for (const { phone, status } of results) {
        const dbStatus = status === 'success' ? 'sent' : status === 'error' ? 'failed' : status;
        await (0, db_1.query)(`INSERT INTO disparo_logs (disparo_id, phone, status) VALUES ($1,$2,$3)
       ON CONFLICT (disparo_id, phone) DO UPDATE SET status=$3, sent_at=NOW()`, [disparo_id, phone, dbStatus]);
        if (dbStatus === 'sent')
            successCount++;
        else
            failCount++;
    }
    const statsRes = await (0, db_1.query)(`SELECT COUNT(*) FILTER (WHERE status='sent') AS sent,
            COUNT(*) FILTER (WHERE status='failed') AS failed,
            COUNT(*) FILTER (WHERE status LIKE 'skipped%') AS skipped,
            COUNT(*) AS total_processed
     FROM disparo_logs WHERE disparo_id = $1`, [disparo_id]);
    const stats = statsRes.rows[0];
    await (0, db_1.query)(`UPDATE disparos SET stats=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(stats), disparo_id]);
    res.json({ message: 'Callback processed', stats });
});
// ---- POST /disparos/create ----
router.post('/disparos/create', async (req, res) => {
    const body = req.body;
    if (!body?.channel || !body?.body || !body?.filters)
        return void res.status(400).json({ error: 'Payload inválido' });
    try {
        const result = await (0, db_1.query)(`INSERT INTO disparos (channel, body, filters, schedule_at, status, instance_name)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at, status`, [body.channel, body.body, JSON.stringify(body.filters),
            body.schedule_at ? new Date(body.schedule_at) : null,
            body.status || 'pending', body.instance_name || null]);
        const d = result.rows[0];
        res.json({ id: d.id, status: d.status, created_at: d.created_at, message: 'Disparo agendado com sucesso.' });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
// ---- POST /mei/submit ----
router.post('/mei/submit', async (req, res) => {
    const { form, userId, userPhone } = req.body;
    if (!form)
        return void res.status(400).json({ error: 'form é obrigatório' });
    try {
        const resultId = await (0, db_1.withClient)(async (client) => {
            let resolvedId = typeof userId === 'number' ? userId : null;
            if (!resolvedId && userPhone) {
                const r = await client.query('SELECT id FROM leads WHERE telefone = $1 LIMIT 1', [userPhone]);
                if (r.rows.length > 0)
                    resolvedId = Number(r.rows[0].id);
            }
            await client.query('BEGIN');
            const extraData = { mei_form_data: { atividade_principal: form.atividade_principal, atividades_secundarias: form.atividades_secundarias, local_atividade: form.local_atividade, titulo_eleitor_ou_recibo_ir: form.titulo_eleitor_ou_recibo_ir } };
            let leadId;
            if (resolvedId) {
                await client.query(`UPDATE leads SET nome_completo=$1, cpf=$2, data_nascimento=$3, nome_mae=$4, email=$5, senha_gov=$6, atualizado_em=NOW() WHERE id=$7`, [form.nome_completo, form.cpf, form.data_nascimento, form.nome_mae, form.email, form.senha_gov, resolvedId]);
                leadId = resolvedId;
                const empCheck = await client.query('SELECT id, dados_serpro FROM leads_empresarial WHERE lead_id=$1', [leadId]);
                if (empCheck.rows.length > 0) {
                    const newDados = { ...((empCheck.rows[0].dados_serpro) || {}), ...extraData };
                    await client.query(`UPDATE leads_empresarial SET nome_fantasia=$1,endereco=$2,numero=$3,complemento=$4,bairro=$5,cidade=$6,estado=$7,cep=$8,dados_serpro=$9,updated_at=NOW() WHERE lead_id=$10`, [form.nome_fantasia, form.endereco, form.numero, form.complemento ?? null, form.bairro, form.cidade, form.estado, form.cep, JSON.stringify(newDados), leadId]);
                }
                else {
                    await client.query(`INSERT INTO leads_empresarial (lead_id,nome_fantasia,endereco,numero,complemento,bairro,cidade,estado,cep,dados_serpro) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [leadId, form.nome_fantasia, form.endereco, form.numero, form.complemento ?? null, form.bairro, form.cidade, form.estado, form.cep, JSON.stringify(extraData)]);
                }
            }
            else {
                const ins = await client.query(`INSERT INTO leads (nome_completo,cpf,data_nascimento,nome_mae,email,senha_gov,telefone,data_cadastro) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING id`, [form.nome_completo, form.cpf, form.data_nascimento, form.nome_mae, form.email, form.senha_gov, form.telefone]);
                leadId = ins.rows[0].id;
                await client.query(`INSERT INTO leads_empresarial (lead_id,nome_fantasia,endereco,numero,complemento,bairro,cidade,estado,cep,dados_serpro) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [leadId, form.nome_fantasia, form.endereco, form.numero, form.complemento ?? null, form.bairro, form.cidade, form.estado, form.cep, JSON.stringify(extraData)]);
            }
            await client.query('COMMIT');
            return leadId;
        });
        res.json({ success: true, id: resultId });
    }
    catch (err) {
        console.error('MEI submit error:', err);
        res.status(500).json({ error: String(err) });
    }
});
// ---- POST /ecac/submit ----
router.post('/ecac/submit', async (req, res) => {
    const { nome_completo, telefone, email, senha_gov } = req.body?.form || {};
    if (!telefone)
        return void res.status(400).json({ error: 'telefone é obrigatório' });
    try {
        const check = await (0, db_1.query)('SELECT id FROM leads WHERE telefone = $1', [telefone]);
        if (check.rows.length > 0) {
            await (0, db_1.query)(`UPDATE leads SET nome_completo=$1, email=$2, senha_gov=$3, atualizado_em=NOW() WHERE telefone=$4`, [nome_completo, email, senha_gov, telefone]);
        }
        else {
            await (0, db_1.query)(`INSERT INTO leads (nome_completo, telefone, email, senha_gov, data_cadastro) VALUES ($1,$2,$3,$4,NOW())`, [nome_completo, telefone, email, senha_gov]);
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
// ---- POST /messages/send ----
router.post('/messages/send', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const expectedKey = process.env.API_KEY || 'haylander-api-key';
    if (apiKey !== expectedKey)
        return void res.status(401).json({ error: 'Unauthorized' });
    const { phone, content, type = 'text', options } = req.body;
    if (!phone || !content)
        return void res.status(400).json({ error: 'Missing required fields' });
    try {
        let result;
        if (type === 'media') {
            result = await (0, evolution_1.evolutionSendMediaMessage)(phone, content, options?.mediaType || 'image', options?.caption || '', options?.fileName || '', '');
        }
        else {
            result = await (0, evolution_1.evolutionSendTextMessage)(phone, content);
        }
        res.json({ success: true, data: result });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal Server Error', details: String(err) });
    }
});
// ---- POST /whatsapp/profile-pic ----
router.post('/whatsapp/profile-pic', async (req, res) => {
    const { phone } = req.body;
    if (!phone)
        return void res.status(400).json({ error: 'Phone is required' });
    try {
        const data = await (0, evolution_1.evolutionGetProfilePic)(phone);
        const url = data?.profilePictureUrl || data?.pictureUrl || data?.url || null;
        res.json({ url });
    }
    catch {
        res.json({ url: null });
    }
});
// ---- POST /whatsapp/sync-contacts ----
router.post('/whatsapp/sync-contacts', async (req, res) => {
    try {
        const chats = await (0, evolution_1.evolutionFindChats)();
        let created = 0;
        let updated = 0;
        for (const chat of chats) {
            const remoteJid = String(chat.id || chat.remoteJid || '');
            const phone = remoteJid.replace(/\D/g, '');
            const pushName = String(chat.pushName || chat.name || '');
            if (!phone || phone.length < 10)
                continue;
            try {
                const existing = await (0, db_1.query)('SELECT id, nome_completo FROM leads WHERE telefone = $1', [phone]);
                if (existing.rows.length === 0) {
                    await (0, db_1.query)(`INSERT INTO leads (telefone, nome_completo, data_cadastro, atualizado_em) VALUES ($1,$2,NOW(),NOW())`, [phone, pushName || 'Desconhecido']);
                    await (0, db_1.query)(`INSERT INTO leads_qualificacao (lead_id, situacao) SELECT id, 'aguardando_qualificação' FROM leads WHERE telefone=$1 ON CONFLICT (lead_id) DO NOTHING`, [phone]);
                    created++;
                }
                else {
                    const currentName = existing.rows[0].nome_completo;
                    const updates = ['atualizado_em = NOW()'];
                    const vals = [];
                    if (pushName && (!currentName || currentName === 'Desconhecido')) {
                        updates.push(`nome_completo = $${vals.length + 1}`);
                        vals.push(pushName);
                    }
                    vals.push(phone);
                    await (0, db_1.query)(`UPDATE leads SET ${updates.join(',')} WHERE telefone = $${vals.length}`, vals);
                    updated++;
                }
            }
            catch (e) {
                console.error(`Error syncing user ${phone}:`, e);
            }
        }
        res.json({ success: true, count: chats.length, created, updated });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ---- GET /whatsapp/check-numbers ----
router.get('/whatsapp/check-numbers', async (req, res) => {
    const numbersRaw = req.query.numbers;
    const numbers = Array.isArray(numbersRaw) ? numbersRaw : (typeof numbersRaw === 'string' ? numbersRaw.split(',') : []);
    try {
        const result = await (0, evolution_1.checkWhatsAppNumbers)(numbers);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
// ---- POST /fallback ----
router.post('/fallback', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET) {
        const token = process.env.CRON_SECRET;
        const isValid = authHeader === `Bearer ${token}` || authHeader === token;
        if (!isValid)
            return void res.status(401).json({ error: 'Unauthorized' });
    }
    const { phone } = req.body;
    if (!phone)
        return void res.status(400).json({ error: 'Phone is required' });
    try {
        const agentName = await redis_1.default.get(`routing_override:${phone}`);
        if (agentName === 'human')
            return void res.json({ message: 'Skipped: Agent is Human' });
        await (0, evolution_1.evolutionSendTextMessage)((0, evolution_1.toWhatsAppJid)(phone), 'Oi ainda esta ai?');
        res.json({ message: 'Nudge sent successfully' });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!password)
        return void res.status(400).json({ error: 'Preencha a senha' });
    if (email) {
        try {
            const { rows } = await db_1.default.query('SELECT id, nome, email, permissoes, senha_hash, ativo FROM colaboradores WHERE LOWER(email) = $1 LIMIT 1', [email.trim().toLowerCase()]);
            if (rows.length > 0) {
                const colab = rows[0];
                if (!colab.ativo)
                    return void res.status(401).json({ error: 'Conta desativada.' });
                if (!colab.senha_hash)
                    return void res.status(401).json({ error: 'Senha não configurada.' });
                const valid = await bcryptjs_1.default.compare(password, colab.senha_hash);
                if (!valid)
                    return void res.status(401).json({ error: 'Senha incorreta' });
                return void res.json({ id: colab.id, nome: colab.nome, email: colab.email, permissoes: colab.permissoes || [] });
            }
        }
        catch (err) {
            console.error('[Login] Erro ao buscar colaborador:', err);
        }
    }
    // Fallback: legacy ADMIN_PASSWORD
    const CORRECT_PASSWORD = process.env.ADMIN_PASSWORD;
    if (CORRECT_PASSWORD && password === CORRECT_PASSWORD) {
        return void res.json({ id: 0, nome: 'Administrador', email: email || 'admin', permissoes: ['admin'] });
    }
    res.status(401).json({ error: 'Credenciais inválidas' });
});
// ---- GET /db-schema ----
router.get('/db-schema', async (_req, res) => {
    try {
        const { rows } = await (0, db_1.query)(`SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`);
        const tables = {};
        rows.forEach(row => {
            if (!tables[row.table_name])
                tables[row.table_name] = [];
            tables[row.table_name].push({ column_name: row.column_name, data_type: row.data_type, is_nullable: row.is_nullable, column_default: row.column_default });
        });
        const result = Object.entries(tables).map(([table_name, columns]) => ({ table_name, columns }));
        res.json({ success: true, data: result });
    }
    catch {
        res.status(500).json({ success: false, error: 'Failed to fetch schema' });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map