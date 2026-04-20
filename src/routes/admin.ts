import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import pool, { query, withClient } from '../lib/db';
import redis from '../lib/redis';
import {
  evolutionSendTextMessage, evolutionSendMediaMessage,
  evolutionFindChats, evolutionGetProfilePic, checkWhatsAppNumbers,
  toWhatsAppJid,
} from '../lib/evolution';

const router = Router();

// ---- GET /dashboard ----

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT
        l.id, l.nome_completo, l.telefone, l.email, l.cnpj,
        l.calculo_parcelamento, l.data_cadastro, l.atualizado_em,
        lp.envio_disparo, l.situacao, l.qualificacao, l.interesse_ajuda,
        l.pos_qualificacao AS confirmacao_qualificacao,
        (lp.data_reuniao IS NOT NULL) AS reuniao_agendada,
        (lp.cliente IS TRUE) AS cliente
      FROM leads l
      LEFT JOIN leads_processo lp ON l.id = lp.lead_id
      ORDER BY l.atualizado_em DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching dashboard data:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ---- POST /disparos/callback ----

router.post('/disparos/callback', async (req: Request, res: Response) => {
  const { disparo_id, results } = req.body;
  if (!disparo_id || !Array.isArray(results)) return void res.status(400).json({ error: 'Invalid payload' });

  let successCount = 0;
  let failCount = 0;
  for (const { phone, status } of results) {
    const dbStatus = status === 'success' ? 'sent' : status === 'error' ? 'failed' : status;
    await query(
      `INSERT INTO disparo_logs (disparo_id, phone, status) VALUES ($1,$2,$3)
       ON CONFLICT (disparo_id, phone) DO UPDATE SET status=$3, sent_at=NOW()`,
      [disparo_id, phone, dbStatus],
    );
    if (dbStatus === 'sent') successCount++;
    else failCount++;
  }

  const statsRes = await query(
    `SELECT COUNT(*) FILTER (WHERE status='sent') AS sent,
            COUNT(*) FILTER (WHERE status='failed') AS failed,
            COUNT(*) FILTER (WHERE status LIKE 'skipped%') AS skipped,
            COUNT(*) AS total_processed
     FROM disparo_logs WHERE disparo_id = $1`,
    [disparo_id],
  );
  const stats = statsRes.rows[0];
  await query(`UPDATE disparos SET stats=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(stats), disparo_id]);
  res.json({ message: 'Callback processed', stats });
});

// ---- POST /disparos/create ----

router.post('/disparos/create', async (req: Request, res: Response) => {
  const body = req.body;
  if (!body?.channel || !body?.body || !body?.filters) return void res.status(400).json({ error: 'Payload inválido' });
  try {
    const result = await query(
      `INSERT INTO disparos (channel, body, filters, schedule_at, status, instance_name)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at, status`,
      [body.channel, body.body, JSON.stringify(body.filters),
        body.schedule_at ? new Date(body.schedule_at) : null,
        body.status || 'pending', body.instance_name || null],
    );
    const d = result.rows[0];
    res.json({ id: d.id, status: d.status, created_at: d.created_at, message: 'Disparo agendado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---- POST /mei/submit ----

router.post('/mei/submit', async (req: Request, res: Response) => {
  const { form, userId, userPhone } = req.body;
  if (!form) return void res.status(400).json({ error: 'form é obrigatório' });

  try {
    const resultId = await withClient(async (client) => {
      let resolvedId: number | null = typeof userId === 'number' ? userId : null;
      if (!resolvedId && userPhone) {
        const r = await client.query('SELECT id FROM leads WHERE telefone = $1 LIMIT 1', [userPhone]);
        if (r.rows.length > 0) resolvedId = Number(r.rows[0].id);
      }

      await client.query('BEGIN');
      const extraData = { mei_form_data: { atividade_principal: form.atividade_principal, atividades_secundarias: form.atividades_secundarias, local_atividade: form.local_atividade, titulo_eleitor_ou_recibo_ir: form.titulo_eleitor_ou_recibo_ir } };

      const cryptoKey = process.env.PGCRYPTO_KEY ?? '';
      let leadId: number;
      if (resolvedId) {
        await client.query(
          `UPDATE leads SET
             nome_completo=$1, cpf=$2, data_nascimento=$3, nome_mae=$4, email=$5,
             senha_gov_enc = CASE WHEN $6::text IS NULL THEN senha_gov_enc ELSE pgp_sym_encrypt($6::text,$7::text) END,
             nome_fantasia=$8, endereco=$9, numero=$10, complemento=$11,
             bairro=$12, cidade=$13, estado=$14, cep=$15,
             metadata = COALESCE(metadata,'{}') || $16::jsonb,
             atualizado_em=NOW()
           WHERE id=$17`,
          [form.nome_completo, form.cpf, form.data_nascimento, form.nome_mae, form.email,
           form.senha_gov || null, cryptoKey,
           form.nome_fantasia, form.endereco, form.numero, form.complemento ?? null,
           form.bairro, form.cidade, form.estado, form.cep,
           JSON.stringify(extraData), resolvedId],
        );
        leadId = resolvedId;
      } else {
        const ins = await client.query(
          `INSERT INTO leads
             (nome_completo,cpf,data_nascimento,nome_mae,email,
              senha_gov_enc,nome_fantasia,endereco,numero,complemento,
              bairro,cidade,estado,cep,metadata,telefone,data_cadastro)
           VALUES ($1,$2,$3,$4,$5,
                   CASE WHEN $6::text IS NULL THEN NULL ELSE pgp_sym_encrypt($6::text,$7::text) END,
                   $8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,NOW())
           RETURNING id`,
          [form.nome_completo, form.cpf, form.data_nascimento, form.nome_mae, form.email,
           form.senha_gov || null, cryptoKey,
           form.nome_fantasia, form.endereco, form.numero, form.complemento ?? null,
           form.bairro, form.cidade, form.estado, form.cep,
           JSON.stringify(extraData), form.telefone],
        );
        leadId = ins.rows[0].id;
      }
      await client.query('COMMIT');
      return leadId;
    });
    res.json({ success: true, id: resultId });
  } catch (err) {
    console.error('MEI submit error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ---- POST /ecac/submit ----

router.post('/ecac/submit', async (req: Request, res: Response) => {
  const { nome_completo, telefone, email, senha_gov } = req.body?.form || {};
  if (!telefone) return void res.status(400).json({ error: 'telefone é obrigatório' });
  const cryptoKey = process.env.PGCRYPTO_KEY ?? '';
  try {
    const check = await query('SELECT id FROM leads WHERE telefone = $1', [telefone]);
    if (check.rows.length > 0) {
      await query(
        `UPDATE leads SET nome_completo=$1, email=$2,
         senha_gov_enc = CASE WHEN $3::text IS NULL THEN senha_gov_enc ELSE pgp_sym_encrypt($3::text,$4::text) END,
         atualizado_em=NOW() WHERE telefone=$5`,
        [nome_completo, email, senha_gov || null, cryptoKey, telefone],
      );
    } else {
      await query(
        `INSERT INTO leads (nome_completo, telefone, email, senha_gov_enc, data_cadastro)
         VALUES ($1,$2,$3, CASE WHEN $4::text IS NULL THEN NULL ELSE pgp_sym_encrypt($4::text,$5::text) END, NOW())`,
        [nome_completo, telefone, email, senha_gov || null, cryptoKey],
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---- POST /messages/send ----

router.post('/messages/send', async (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.API_KEY || 'haylander-api-key';
  if (apiKey !== expectedKey) return void res.status(401).json({ error: 'Unauthorized' });

  const { phone, content, type = 'text', options } = req.body;
  if (!phone || !content) return void res.status(400).json({ error: 'Missing required fields' });

  try {
    let result: unknown;
    if (type === 'media') {
      result = await evolutionSendMediaMessage(phone, content, options?.mediaType || 'image', options?.caption || '', options?.fileName || '', '');
    } else {
      result = await evolutionSendTextMessage(phone, content);
    }
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', details: String(err) });
  }
});

// ---- POST /whatsapp/profile-pic ----

router.post('/whatsapp/profile-pic', async (req: Request, res: Response) => {
  const { phone } = req.body;
  if (!phone) return void res.status(400).json({ error: 'Phone is required' });
  try {
    const data = await evolutionGetProfilePic(phone) as Record<string, unknown> | null;
    const url = data?.profilePictureUrl || data?.pictureUrl || data?.url || null;
    res.json({ url });
  } catch {
    res.json({ url: null });
  }
});

// ---- POST /whatsapp/sync-contacts ----

router.post('/whatsapp/sync-contacts', async (req: Request, res: Response) => {
  try {
    const chats = await evolutionFindChats() as Array<Record<string, unknown>>;
    let created = 0;
    let updated = 0;

    for (const chat of chats) {
      const remoteJid = String(chat.id || chat.remoteJid || '');
      const phone = remoteJid.replace(/\D/g, '');
      const pushName = String(chat.pushName || chat.name || '');
      if (!phone || phone.length < 10) continue;

      try {
        const existing = await query('SELECT id, nome_completo FROM leads WHERE telefone = $1', [phone]);
        if (existing.rows.length === 0) {
          await query(
            `INSERT INTO leads (telefone, nome_completo, data_cadastro, atualizado_em) VALUES ($1,$2,NOW(),NOW())`,
            [phone, pushName || 'Desconhecido'],
          );
          await query(
            `UPDATE leads SET situacao = 'aguardando_qualificacao', atualizado_em = NOW() WHERE telefone = $1`,
            [phone],
          );
          created++;
        } else {
          const currentName = existing.rows[0].nome_completo;
          const updates: string[] = ['atualizado_em = NOW()'];
          const vals: unknown[] = [];
          if (pushName && (!currentName || currentName === 'Desconhecido')) {
            updates.push(`nome_completo = $${vals.length + 1}`);
            vals.push(pushName);
          }
          vals.push(phone);
          await query(`UPDATE leads SET ${updates.join(',')} WHERE telefone = $${vals.length}`, vals);
          updated++;
        }
      } catch (e) {
        console.error(`Error syncing user ${phone}:`, e);
      }
    }

    res.json({ success: true, count: chats.length, created, updated });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- GET /whatsapp/check-numbers ----

router.get('/whatsapp/check-numbers', async (req: Request, res: Response) => {
  const numbersRaw = req.query.numbers;
  const numbers = Array.isArray(numbersRaw) ? numbersRaw as string[] : (typeof numbersRaw === 'string' ? numbersRaw.split(',') : []);
  try {
    const result = await checkWhatsAppNumbers(numbers);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---- POST /fallback ----

router.post('/fallback', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET) {
    const token = process.env.CRON_SECRET;
    const isValid = authHeader === `Bearer ${token}` || authHeader === token;
    if (!isValid) return void res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone } = req.body;
  if (!phone) return void res.status(400).json({ error: 'Phone is required' });

  try {
    const agentName = await redis.get(`routing_override:${phone}`);
    if (agentName === 'human') return void res.json({ message: 'Skipped: Agent is Human' });
    await evolutionSendTextMessage(toWhatsAppJid(phone), 'Oi ainda esta ai?');
    res.json({ message: 'Nudge sent successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ---- POST /auth/login ----

type ColaboradorRow = { id: number; nome: string; email: string; permissoes: string[]; senha_hash: string | null; ativo: boolean };

router.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!password) return void res.status(400).json({ error: 'Preencha a senha' });

  if (email) {
    try {
      const { rows } = await pool.query<ColaboradorRow>(
        'SELECT id, nome, email, permissoes, senha_hash, ativo FROM colaboradores WHERE LOWER(email) = $1 LIMIT 1',
        [email.trim().toLowerCase()],
      );
      if (rows.length > 0) {
        const colab = rows[0];
        if (!colab.ativo) return void res.status(401).json({ error: 'Conta desativada.' });
        if (!colab.senha_hash) return void res.status(401).json({ error: 'Senha não configurada.' });
        const valid = await bcrypt.compare(password, colab.senha_hash);
        if (!valid) return void res.status(401).json({ error: 'Senha incorreta' });
        return void res.json({ id: colab.id, nome: colab.nome, email: colab.email, permissoes: colab.permissoes || [] });
      }
    } catch (err) {
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
router.get('/db-schema', async (_req: Request, res: Response) => {
  try {
    const { rows } = await query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`
    );
    const tables: Record<string, { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]> = {};
    rows.forEach(row => {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push({ column_name: row.column_name, data_type: row.data_type, is_nullable: row.is_nullable, column_default: row.column_default });
    });
    const result = Object.entries(tables).map(([table_name, columns]) => ({ table_name, columns }));
    res.json({ success: true, data: result });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch schema' });
  }
});

export default router;
