import { Router, Request, Response } from 'express';
import { query, withClient } from '../lib/db';
import { evolutionSendTextMessage } from '../lib/evolution';

function toJid(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  return clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
}

const CRYPTO_KEY = () => process.env.PGCRYPTO_KEY ?? '';

const router = Router();

// ─── SQL helpers ─────────────────────────────────────────────────────────────

// Single JOIN — leads + leads_processo
// senha_gov is decrypted in-query; reuniao_agendada is derived from data_reuniao
function fullLeadSelect(keyParam: string): string {
  return `
    SELECT
      l.id, l.telefone, l.nome_completo, l.email, l.cpf, l.data_nascimento, l.nome_mae, l.sexo,
      l.cnpj, l.razao_social, l.nome_fantasia, l.tipo_negocio, l.faturamento_mensal,
      l.endereco, l.numero, l.complemento, l.bairro, l.cidade, l.estado, l.cep,
      l.situacao, l.qualificacao, l.motivo_qualificacao, l.interesse_ajuda,
      l.pos_qualificacao, l.possui_socio, l.confirmacao_qualificacao,
      l.tem_divida, l.tipo_divida, l.valor_divida_municipal, l.valor_divida_estadual,
      l.valor_divida_federal, l.valor_divida_pgfn, l.valor_divida_pgfn AS valor_divida_ativa, l.tempo_divida, l.calculo_parcelamento,
      l.needs_attendant, l.attendant_requested_at, l.metadata, l.data_cadastro, l.atualizado_em,
      CASE WHEN l.senha_gov_enc IS NULL THEN NULL
           ELSE pgp_sym_decrypt(l.senha_gov_enc::bytea, ${keyParam})
      END AS senha_gov,
      lp.servico, lp.servico AS servico_negociado, lp.servico AS servico_escolhido, lp.status_atendimento, lp.data_reuniao,
      (lp.data_reuniao IS NOT NULL) AS reuniao_agendada,
      lp.procuracao, lp.procuracao_ativa, lp.procuracao_validade, lp.cliente,
      lp.atendente_id, lp.envio_disparo, lp.observacoes,
      lp.data_controle_24h, lp.data_followup, lp.recursos_entregues
    FROM leads l
    LEFT JOIN leads_processo lp ON l.id = lp.lead_id
  `;
}

// Maps every updatable field to its table
const COLUMN_TABLE_MAP: Record<string, string> = {
  // leads
  telefone: 'leads', nome_completo: 'leads', email: 'leads', cpf: 'leads',
  data_nascimento: 'leads', nome_mae: 'leads', sexo: 'leads', senha_gov: 'leads',
  cnpj: 'leads', razao_social: 'leads', nome_fantasia: 'leads', tipo_negocio: 'leads',
  faturamento_mensal: 'leads', endereco: 'leads', numero: 'leads', complemento: 'leads',
  bairro: 'leads', cidade: 'leads', estado: 'leads', cep: 'leads',
  situacao: 'leads', qualificacao: 'leads', motivo_qualificacao: 'leads',
  interesse_ajuda: 'leads', pos_qualificacao: 'leads', possui_socio: 'leads',
  confirmacao_qualificacao: 'leads', tem_divida: 'leads', tipo_divida: 'leads',
  valor_divida_municipal: 'leads', valor_divida_estadual: 'leads',
  valor_divida_federal: 'leads', valor_divida_pgfn: 'leads', valor_divida_ativa: 'leads',
  tempo_divida: 'leads', calculo_parcelamento: 'leads', needs_attendant: 'leads',
  metadata: 'leads', atualizado_em: 'leads', data_cadastro: 'leads',
  // leads_processo
  servico: 'leads_processo', status_atendimento: 'leads_processo',
  data_reuniao: 'leads_processo', procuracao: 'leads_processo',
  procuracao_ativa: 'leads_processo', procuracao_validade: 'leads_processo',
  cliente: 'leads_processo', atendente_id: 'leads_processo',
  envio_disparo: 'leads_processo', observacoes: 'leads_processo',
  data_controle_24h: 'leads_processo', data_followup: 'leads_processo',
  recursos_entregues: 'leads_processo',
};

// Backward-compat aliases (old column names → new)
const COLUMN_ALIAS_MAP: Record<string, string> = {
  teria_interesse:    'interesse_ajuda',
  servico_escolhido:  'servico',
  servico_negociado:  'servico',
  valor_divida_ativa: 'valor_divida_pgfn',
  cartao_cnpj:        'metadata',
  dados_serpro:       'metadata',
};

// ─── GET /leads/user/:phone ───────────────────────────────────────────────────

router.get('/leads/user/:phone', async (req: Request, res: Response) => {
  const identifier = req.params.phone;
  const col = identifier.includes('@') ? 'l.email' : 'l.telefone';
  const key = CRYPTO_KEY();
  try {
    const result = await query(`${fullLeadSelect('$2')} WHERE ${col} = $1`, [identifier, key]);
    if (result.rows.length === 0) return void res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', details: String(err) });
  }
});

// ─── PUT /leads/user/:phone ───────────────────────────────────────────────────

async function notifyMeetingAttendant(nome: string, telefone: string, data_reuniao: string, observacoes: string) {
  const attendantNumber = process.env.ATTENDANT_PHONE;
  if (!attendantNumber) return;
  const text = `📅 *Nova Reunião Marcada!*\n\n👤 *Cliente:* ${nome}\n📞 *Telefone:* ${telefone}\n🗓️ *Data/Hora:* ${data_reuniao}\n📝 *Obs:* ${observacoes || 'Sem observações'}`;
  await evolutionSendTextMessage(toJid(attendantNumber), text).catch(console.error);
}

router.put('/leads/user/:phone', async (req: Request, res: Response) => {
  const identifier = req.params.phone;
  const isEmail = identifier.includes('@');
  const body = req.body;
  const {
    nome_completo, telefone, email, senha_gov, cnpj, tipo_negocio,
    possui_socio, tipo_divida, valor_divida_municipal, valor_divida_estadual,
    valor_divida_federal, valor_divida_pgfn, valor_divida_ativa,
    faturamento_mensal, observacoes, interesse_ajuda, teria_interesse,
    calculo_parcelamento, data_reuniao,
  } = body;

  const finalInteresse = interesse_ajuda || teria_interesse || null;
  const finalPossuiSocio = possui_socio === 'Sim' || possui_socio === true;
  const finalValorPgfn = valor_divida_pgfn ?? valor_divida_ativa ?? null;
  const key = CRYPTO_KEY();

  try {
    const leadId = await withClient(async (client) => {
      await client.query('BEGIN');

      const idRes = await client.query(
        `SELECT id FROM leads WHERE ${isEmail ? 'email' : 'telefone'} = $1`,
        [identifier],
      );

      let id: number;
      if (idRes.rowCount === 0) {
        const ins = await client.query(
          `INSERT INTO leads (telefone, nome_completo, email, senha_gov_enc, data_cadastro, atualizado_em)
           VALUES ($1, $2, $3, CASE WHEN $4::text IS NULL THEN NULL ELSE pgp_sym_encrypt($4::text, $5::text) END, NOW(), NOW())
           RETURNING id`,
          [
            isEmail ? (telefone || null) : identifier,
            nome_completo || 'Desconhecido',
            isEmail ? identifier : (email || null),
            senha_gov || null,
            key,
          ],
        );
        id = ins.rows[0].id;
      } else {
        id = idRes.rows[0].id;
        await client.query(
          `UPDATE leads SET
             nome_completo  = COALESCE($2, nome_completo),
             telefone       = COALESCE($3, telefone),
             email          = COALESCE($4, email),
             senha_gov_enc  = CASE WHEN $5::text IS NULL THEN senha_gov_enc
                                   ELSE pgp_sym_encrypt($5::text, $6::text) END,
             atualizado_em  = NOW()
           WHERE id = $1`,
          [id, nome_completo, telefone, email, senha_gov || null, key],
        );
      }

      await client.query(
        `UPDATE leads SET
           cnpj               = COALESCE($2, cnpj),
           tipo_negocio       = COALESCE($3, tipo_negocio),
           faturamento_mensal = COALESCE($4, faturamento_mensal),
           interesse_ajuda    = COALESCE($5, interesse_ajuda),
           possui_socio       = COALESCE($6, possui_socio),
           tipo_divida        = COALESCE($7, tipo_divida),
           valor_divida_municipal = COALESCE($8, valor_divida_municipal),
           valor_divida_estadual  = COALESCE($9, valor_divida_estadual),
           valor_divida_federal   = COALESCE($10, valor_divida_federal),
           valor_divida_pgfn      = COALESCE($11, valor_divida_pgfn),
           calculo_parcelamento   = COALESCE($12, calculo_parcelamento),
           tem_divida             = CASE WHEN $7::text IS NOT NULL THEN TRUE ELSE tem_divida END,
           atualizado_em          = NOW()
         WHERE id = $1`,
        [id, cnpj, tipo_negocio, faturamento_mensal, finalInteresse,
         finalPossuiSocio || null, tipo_divida, valor_divida_municipal,
         valor_divida_estadual, valor_divida_federal, finalValorPgfn, calculo_parcelamento],
      );

      await client.query(
        `INSERT INTO leads_processo (lead_id, envio_disparo, data_controle_24h, observacoes)
         VALUES ($1, 'a1', NOW(), $2)
         ON CONFLICT (lead_id) DO UPDATE SET
           observacoes     = COALESCE(EXCLUDED.observacoes, leads_processo.observacoes),
           envio_disparo   = 'a1',
           data_controle_24h = NOW(),
           updated_at      = NOW()`,
        [id, observacoes],
      );

      if (data_reuniao) {
        await client.query(
          `INSERT INTO leads_processo (lead_id, data_reuniao, status_atendimento)
           VALUES ($1, $2, 'reuniao')
           ON CONFLICT (lead_id) DO UPDATE SET
             data_reuniao       = EXCLUDED.data_reuniao,
             status_atendimento = 'reuniao',
             updated_at         = NOW()`,
          [id, data_reuniao],
        );
      }

      await client.query('COMMIT');
      return id;
    });

    if (data_reuniao) {
      notifyMeetingAttendant(
        nome_completo || identifier,
        telefone || identifier,
        data_reuniao,
        observacoes,
      );
    }

    const updated = await query(`${fullLeadSelect('$2')} WHERE l.id = $1`, [leadId, key]);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('PUT /leads/user error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: String(err) });
  }
});

// ─── GET /leads/unique-values ─────────────────────────────────────────────────

router.get('/leads/unique-values', async (req: Request, res: Response) => {
  const column = req.query.column as string;
  if (!column) return void res.status(400).json({ error: 'Column parameter is required' });

  const realColumn = COLUMN_ALIAS_MAP[column] || column;
  const tableName = COLUMN_TABLE_MAP[realColumn] || COLUMN_TABLE_MAP[column];
  if (!tableName) return void res.json({ values: [] });
  if (!/^[a-zA-Z0-9_]+$/.test(realColumn)) return void res.status(400).json({ error: 'Invalid column name' });

  try {
    const result = await query(
      `SELECT DISTINCT ${realColumn} AS value FROM ${tableName}
       WHERE ${realColumn} IS NOT NULL ORDER BY ${realColumn} ASC LIMIT 1000`,
    );
    res.json({ values: result.rows.map((r) => r.value).filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch values' });
  }
});

// ─── POST /leads/bulk-update ──────────────────────────────────────────────────

router.post('/leads/bulk-update', async (req: Request, res: Response) => {
  const body = req.body;
  const column: string = body?.where?.column ?? body.column;
  const operator: string = body?.where?.operator ?? body.operator;
  const values: string[] = Array.isArray(body?.where?.values ?? body.values) ? (body?.where?.values ?? body.values) : [];
  const updateColumnRaw: string = body?.update?.column ?? body.updateColumn ?? column;
  const updateAction: string = body?.update?.action ?? body.updateAction ?? (body?.update?.empty ? 'set_empty' : 'set_value');
  const updateValueRaw: unknown = body?.update?.value ?? body.updateValue;

  if (!column || !operator) return void res.status(400).json({ error: 'where.column e where.operator são obrigatórios' });

  const updateColumn = COLUMN_ALIAS_MAP[updateColumnRaw] || updateColumnRaw;
  const whereColumnReal = COLUMN_ALIAS_MAP[column] || column;

  const allowedUpdateColumns: Record<string, { col: string; type: string }> = {
    telefone: { col: 'telefone', type: 'text' }, nome_completo: { col: 'nome_completo', type: 'text' },
    razao_social: { col: 'razao_social', type: 'text' }, cnpj: { col: 'cnpj', type: 'text' },
    email: { col: 'email', type: 'text' }, observacoes: { col: 'observacoes', type: 'text' },
    calculo_parcelamento: { col: 'calculo_parcelamento', type: 'text' },
    atualizado_em: { col: 'atualizado_em', type: 'timestamp' },
    data_cadastro: { col: 'data_cadastro', type: 'timestamp' },
    data_controle_24h: { col: 'data_controle_24h', type: 'timestamp' },
    envio_disparo: { col: 'envio_disparo', type: 'text' },
    situacao: { col: 'situacao', type: 'text' }, qualificacao: { col: 'qualificacao', type: 'text' },
    motivo_qualificacao: { col: 'motivo_qualificacao', type: 'text' },
    interesse_ajuda: { col: 'interesse_ajuda', type: 'text' },
    valor_divida_pgfn: { col: 'valor_divida_pgfn', type: 'text' },
    valor_divida_municipal: { col: 'valor_divida_municipal', type: 'text' },
    valor_divida_estadual: { col: 'valor_divida_estadual', type: 'text' },
    valor_divida_federal: { col: 'valor_divida_federal', type: 'text' },
    tipo_divida: { col: 'tipo_divida', type: 'text' },
    tipo_negocio: { col: 'tipo_negocio', type: 'text' },
    faturamento_mensal: { col: 'faturamento_mensal', type: 'text' },
    possui_socio: { col: 'possui_socio', type: 'boolean' },
    pos_qualificacao: { col: 'pos_qualificacao', type: 'boolean' },
    servico: { col: 'servico', type: 'text' },
    procuracao: { col: 'procuracao', type: 'boolean' },
    data_reuniao: { col: 'data_reuniao', type: 'timestamp' },
  };

  const updateTableName = COLUMN_TABLE_MAP[updateColumn];
  if (!updateTableName) return void res.status(400).json({ error: 'Coluna de atualização inválida ou não mapeada' });

  const dbUpdate = allowedUpdateColumns[updateColumn];
  if (!dbUpdate) return void res.status(400).json({ error: 'Coluna de atualização não permitida' });

  const whereTableName = COLUMN_TABLE_MAP[whereColumnReal] || 'leads';

  const params: unknown[] = [];
  let setSql = '';

  if (updateAction === 'set_empty') {
    setSql = `SET ${dbUpdate.col} = NULL`;
  } else if (updateAction === 'toggle_boolean') {
    if (dbUpdate.type !== 'boolean') return void res.status(400).json({ error: 'Toggle booleano só é válido para colunas booleanas' });
    setSql = `SET ${dbUpdate.col} = NOT COALESCE(${dbUpdate.col}::boolean, FALSE)`;
  } else {
    if (updateValueRaw === undefined || updateValueRaw === null) return void res.status(400).json({ error: 'Informe o novo valor para set_value' });
    const cast = dbUpdate.type === 'boolean' ? '::boolean' : dbUpdate.type === 'timestamp' ? '::timestamp' : '';
    setSql = `SET ${dbUpdate.col} = $1${cast}`;
    params.push(String(updateValueRaw));
  }

  const tsCol = updateTableName === 'leads' ? 'atualizado_em' : 'updated_at';
  setSql += `, ${tsCol} = NOW()`;

  let whereSql = '';
  const whereParams: unknown[] = [];
  const whereColRef = `${whereColumnReal}`;

  switch (operator) {
    case 'in':         whereSql = `${whereColRef}::text = ANY($${params.length + 1})`; whereParams.push(values); break;
    case 'not_in':     whereSql = `NOT (${whereColRef}::text = ANY($${params.length + 1})) OR ${whereColRef} IS NULL`; whereParams.push(values); break;
    case 'is_empty':   whereSql = `${whereColRef} IS NULL OR ${whereColRef}::text = ''`; break;
    case 'is_not_empty': whereSql = `${whereColRef} IS NOT NULL AND ${whereColRef}::text <> ''`; break;
    default: return void res.status(400).json({ error: 'Operador inválido' });
  }

  let sql = '';
  if (updateTableName === whereTableName) {
    sql = `UPDATE ${updateTableName} ${setSql} WHERE ${whereSql}`;
  } else if (updateTableName === 'leads' && whereTableName === 'leads_processo') {
    sql = `UPDATE leads ${setSql} FROM leads_processo lp WHERE leads.id = lp.lead_id AND ${whereSql}`;
  } else if (updateTableName === 'leads_processo' && whereTableName === 'leads') {
    sql = `UPDATE leads_processo ${setSql} FROM leads l WHERE leads_processo.lead_id = l.id AND ${whereSql}`;
  } else {
    sql = `UPDATE ${updateTableName} ${setSql} WHERE lead_id IN (SELECT id FROM leads WHERE ${whereSql})`;
  }

  try {
    const result = await query(sql, [...params, ...whereParams]);
    res.json({ success: true, updated: result.rowCount });
  } catch (err) {
    console.error('Bulk update error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /leads/bulk-delete ──────────────────────────────────────────────────

router.post('/leads/bulk-delete', async (req: Request, res: Response) => {
  const body = req.body;

  if (body.qualification !== undefined) {
    const qual = body.qualification;
    const sql = qual === 'vazio'
      ? `DELETE FROM leads WHERE qualificacao IS NULL OR qualificacao = ''`
      : `DELETE FROM leads WHERE qualificacao = $1`;
    try {
      const result = await query(sql, qual === 'vazio' ? [] : [qual]);
      return void res.json({ success: true, deleted: result.rowCount });
    } catch (err) {
      return void res.status(500).json({ error: String(err) });
    }
  }

  const column: string = body.column;
  const operator: string = body.operator;
  const values: string[] = Array.isArray(body.values) ? body.values : [];

  if (!column || !operator) return void res.status(400).json({ error: 'column e operator são obrigatórios' });

  const realColumn = COLUMN_ALIAS_MAP[column] || column;
  const whereTableName = COLUMN_TABLE_MAP[realColumn] || 'leads';

  let whereClause = '';
  let params: unknown[] = [];
  switch (operator) {
    case 'in':         whereClause = `${realColumn}::text = ANY($1)`; params = [values]; break;
    case 'not_in':     whereClause = `NOT (${realColumn}::text = ANY($1)) OR ${realColumn} IS NULL`; params = [values]; break;
    case 'is_empty':   whereClause = `${realColumn} IS NULL OR ${realColumn}::text = ''`; break;
    case 'is_not_empty': whereClause = `${realColumn} IS NOT NULL AND ${realColumn}::text <> ''`; break;
    default: return void res.status(400).json({ error: 'Operador inválido' });
  }

  const sql = whereTableName === 'leads'
    ? `DELETE FROM leads WHERE ${whereClause}`
    : `DELETE FROM leads USING ${whereTableName} t WHERE leads.id = t.lead_id AND ${whereClause}`;

  try {
    const result = await query(sql, params);
    res.json({ success: true, deleted: result.rowCount });
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /leads/delete ───────────────────────────────────────────────────────

router.post('/leads/delete', async (req: Request, res: Response) => {
  const { telefone } = req.body;
  if (!telefone) return void res.status(400).json({ success: false, message: 'Telefone é obrigatório' });
  try {
    await query('DELETE FROM leads WHERE telefone = $1', [telefone]);
    res.json({ success: true, message: 'Lead excluído com sucesso' });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ success: false, message: 'Erro ao excluir lead' });
  }
});

// ─── PUT /leads/update-fields ─────────────────────────────────────────────────

router.put('/leads/update-fields', async (req: Request, res: Response) => {
  const { telefone, updates } = req.body;
  if (!telefone || !updates) return void res.status(400).json({ success: false, message: 'telefone e updates são obrigatórios' });

  const key = CRYPTO_KEY();

  const leadsColumns = new Set([
    'nome_completo', 'email', 'cpf', 'data_nascimento', 'nome_mae', 'sexo', 'senha_gov',
    'cnpj', 'razao_social', 'nome_fantasia', 'tipo_negocio', 'faturamento_mensal',
    'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep',
    'situacao', 'qualificacao', 'motivo_qualificacao', 'interesse_ajuda',
    'pos_qualificacao', 'possui_socio', 'confirmacao_qualificacao',
    'tem_divida', 'tipo_divida', 'valor_divida_municipal', 'valor_divida_estadual',
    'valor_divida_federal', 'valor_divida_pgfn', 'valor_divida_ativa',
    'tempo_divida', 'calculo_parcelamento', 'needs_attendant', 'metadata',
  ]);

  const processoColumns = new Set([
    'servico', 'status_atendimento', 'data_reuniao', 'procuracao', 'procuracao_ativa',
    'procuracao_validade', 'cliente', 'atendente_id', 'envio_disparo', 'observacoes',
    'data_controle_24h', 'data_followup', 'recursos_entregues',
  ]);

  const booleanColumns = new Set(['possui_socio', 'pos_qualificacao', 'procuracao', 'tem_divida',
    'procuracao_ativa', 'confirmacao_qualificacao', 'cliente', 'needs_attendant']);
  const dateColumns = new Set(['data_reuniao', 'data_cadastro', 'data_controle_24h',
    'procuracao_validade', 'data_nascimento', 'data_followup']);

  const leadsFields: Record<string, unknown> = {};
  const processoFields: Record<string, unknown> = {};

  for (const [rawKey, v] of Object.entries(updates as Record<string, unknown>)) {
    const k = COLUMN_ALIAS_MAP[rawKey] || rawKey;
    let value: unknown = v;
    if (booleanColumns.has(k)) value = typeof v === 'string' ? ['sim', 'true', '1'].includes(v.trim().toLowerCase()) : !!v;
    if (dateColumns.has(k) && typeof v === 'string') {
      const d = new Date(v);
      value = isNaN(d.getTime()) ? v : d.toISOString();
    }
    if (leadsColumns.has(k)) leadsFields[k] = value;
    else if (processoColumns.has(k)) processoFields[k] = value;
  }

  if (Object.keys(leadsFields).length === 0 && Object.keys(processoFields).length === 0) {
    return void res.status(400).json({ success: false, message: 'Nenhum campo válido para atualizar' });
  }

  try {
    await withClient(async (client) => {
      await client.query('BEGIN');
      const leadRes = await client.query('SELECT id FROM leads WHERE telefone = $1', [telefone]);
      if (leadRes.rowCount === 0) throw new Error('Lead not found');
      const leadId = leadRes.rows[0].id;

      if (Object.keys(leadsFields).length > 0) {
        const setClauses: string[] = [];
        const vals: unknown[] = [leadId];

        for (const [k, v] of Object.entries(leadsFields)) {
          if (k === 'senha_gov') {
            setClauses.push(`senha_gov_enc = CASE WHEN $${vals.length + 1}::text IS NULL THEN senha_gov_enc ELSE pgp_sym_encrypt($${vals.length + 1}::text, $${vals.length + 2}::text) END`);
            vals.push(v, key);
          } else {
            setClauses.push(`${k} = $${vals.length + 1}`);
            vals.push(v);
          }
        }
        await client.query(`UPDATE leads SET ${setClauses.join(', ')}, atualizado_em=NOW() WHERE id=$1`, vals);
      }

      if (Object.keys(processoFields).length > 0) {
        const keys = Object.keys(processoFields);
        const cols = ['lead_id', ...keys].join(', ');
        const placeholders = ['$1', ...keys.map((_, i) => `$${i + 2}`)].join(', ');
        const updateSet = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
        await client.query(
          `INSERT INTO leads_processo (${cols}) VALUES (${placeholders})
           ON CONFLICT (lead_id) DO UPDATE SET ${updateSet}, updated_at=NOW()`,
          [leadId, ...Object.values(processoFields)],
        );
      }

      await client.query('COMMIT');
    });
    res.json({ success: true, message: 'Ficha atualizada com sucesso' });
  } catch (err) {
    console.error('update-fields error:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar ficha' });
  }
});

export default router;
