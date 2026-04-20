"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const evolution_1 = require("../lib/evolution");
function toJid(phone) {
    const clean = phone.replace(/\D/g, '');
    return clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
}
const router = (0, express_1.Router)();
// ---- SQL Helpers ----
const FULL_LEAD_SELECT = `
  SELECT
    l.id, l.telefone, l.nome_completo, l.email, l.senha_gov, l.data_cadastro, l.atualizado_em,
    le.razao_social, le.cnpj, le.cartao_cnpj, le.tipo_negocio, le.faturamento_mensal,
    le.endereco, le.numero, le.complemento, le.bairro, le.cidade, le.estado, le.cep, le.dados_serpro,
    la.observacoes, la.data_controle_24h, la.envio_disparo, la.data_ultima_consulta, la.atendente_id,
    lf.calculo_parcelamento, lf.valor_divida_ativa, lf.valor_divida_municipal,
    lf.valor_divida_estadual, lf.valor_divida_federal, lf.tipo_divida, lf.tem_divida, lf.tempo_divida,
    lq.situacao, lq.qualificacao, lq.motivo_qualificacao, lq.interesse_ajuda, lq.pos_qualificacao, lq.possui_socio,
    lv.servico_negociado, lv.procuracao, lv.procuracao_ativa, lv.procuracao_validade, lv.data_reuniao, lv.status_atendimento
  FROM leads l
  LEFT JOIN leads_empresarial le ON l.id = le.lead_id
  LEFT JOIN leads_qualificacao lq ON l.id = lq.lead_id
  LEFT JOIN leads_financeiro lf ON l.id = lf.lead_id
  LEFT JOIN leads_vendas lv ON l.id = lv.lead_id
  LEFT JOIN leads_atendimento la ON l.id = la.lead_id
`;
const COLUMN_TABLE_MAP = {
    telefone: 'leads', nome_completo: 'leads', email: 'leads', atualizado_em: 'leads', data_cadastro: 'leads',
    cnpj: 'leads_empresarial', razao_social: 'leads_empresarial', tipo_negocio: 'leads_empresarial',
    faturamento_mensal: 'leads_empresarial', cartao_cnpj: 'leads_empresarial',
    situacao: 'leads_qualificacao', qualificacao: 'leads_qualificacao', motivo_qualificacao: 'leads_qualificacao',
    interesse_ajuda: 'leads_qualificacao', pos_qualificacao: 'leads_qualificacao', possui_socio: 'leads_qualificacao',
    calculo_parcelamento: 'leads_financeiro', valor_divida_ativa: 'leads_financeiro',
    valor_divida_municipal: 'leads_financeiro', valor_divida_estadual: 'leads_financeiro',
    valor_divida_federal: 'leads_financeiro', tipo_divida: 'leads_financeiro',
    servico_negociado: 'leads_vendas', procuracao: 'leads_vendas', data_reuniao: 'leads_vendas',
    observacoes: 'leads_atendimento', data_controle_24h: 'leads_atendimento',
    envio_disparo: 'leads_atendimento', data_ultima_consulta: 'leads_atendimento',
    teria_interesse: 'leads_qualificacao', servico_escolhido: 'leads_vendas',
    reuniao_agendada: 'leads_vendas', cliente: 'leads_vendas', confirmacao_qualificacao: 'leads_qualificacao',
    vendido: 'leads_vendas', status_atendimento: 'leads_vendas',
};
const COLUMN_ALIAS_MAP = {
    teria_interesse: 'interesse_ajuda',
    servico_escolhido: 'servico_negociado',
};
const TABLE_ALIAS_MAP = {
    leads: 'l', leads_empresarial: 'le', leads_qualificacao: 'lq',
    leads_financeiro: 'lf', leads_vendas: 'lv', leads_atendimento: 'la',
};
// ---- GET /leads/user/:phone ----
router.get('/leads/user/:phone', async (req, res) => {
    const identifier = req.params.phone;
    const col = identifier.includes('@') ? 'l.email' : 'l.telefone';
    try {
        const result = await (0, db_1.query)(`${FULL_LEAD_SELECT} WHERE ${col} = $1`, [identifier]);
        if (result.rows.length === 0)
            return void res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal Server Error', details: String(err) });
    }
});
// ---- PUT /leads/user/:phone ----
async function notifyMeetingAttendant(nome, telefone, data_reuniao, observacoes) {
    const attendantNumber = process.env.ATTENDANT_PHONE;
    if (!attendantNumber)
        return;
    const text = `📅 *Nova Reunião Marcada!*\n\n👤 *Cliente:* ${nome}\n📞 *Telefone:* ${telefone}\n🗓️ *Data/Hora:* ${data_reuniao}\n📝 *Obs:* ${observacoes || 'Sem observações'}`;
    await (0, evolution_1.evolutionSendTextMessage)(toJid(attendantNumber), text).catch(console.error);
}
router.put('/leads/user/:phone', async (req, res) => {
    const identifier = req.params.phone;
    const isEmail = identifier.includes('@');
    const body = req.body;
    const { nome_completo, telefone, email, senha_gov, cnpj, tipo_negocio, possui_socio, tipo_divida, valor_divida_municipal, valor_divida_estadual, valor_divida_federal, valor_divida_ativa, faturamento_mensal, observacoes, interesse_ajuda, teria_interesse, calculo_parcelamento, data_reuniao, } = body;
    const finalInteresse = interesse_ajuda || teria_interesse || null;
    const finalPossuiSocio = possui_socio === 'Sim' || possui_socio === true;
    try {
        const leadId = await (0, db_1.withClient)(async (client) => {
            await client.query('BEGIN');
            const idRes = await client.query(`SELECT id FROM leads WHERE ${isEmail ? 'email' : 'telefone'} = $1`, [identifier]);
            let id;
            if (idRes.rowCount === 0) {
                const ins = await client.query(`INSERT INTO leads (telefone, nome_completo, email, senha_gov, data_cadastro, atualizado_em)
           VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`, [isEmail ? (telefone || null) : identifier, nome_completo || 'Desconhecido',
                    isEmail ? identifier : (email || null), senha_gov || null]);
                id = ins.rows[0].id;
            }
            else {
                id = idRes.rows[0].id;
                await client.query(`UPDATE leads SET nome_completo=COALESCE($2,nome_completo), telefone=COALESCE($3,telefone),
           email=COALESCE($4,email), senha_gov=COALESCE($5,senha_gov), atualizado_em=NOW() WHERE id=$1`, [id, nome_completo, telefone, email, senha_gov]);
            }
            await client.query(`INSERT INTO leads_empresarial (lead_id, cnpj, tipo_negocio, faturamento_mensal)
         VALUES ($1,$2,$3,$4) ON CONFLICT (lead_id) DO UPDATE SET
         cnpj=COALESCE(EXCLUDED.cnpj,leads_empresarial.cnpj),
         tipo_negocio=COALESCE(EXCLUDED.tipo_negocio,leads_empresarial.tipo_negocio),
         faturamento_mensal=COALESCE(EXCLUDED.faturamento_mensal,leads_empresarial.faturamento_mensal),
         updated_at=NOW()`, [id, cnpj, tipo_negocio, faturamento_mensal]);
            await client.query(`INSERT INTO leads_qualificacao (lead_id, possui_socio, interesse_ajuda) VALUES ($1,$2,$3)
         ON CONFLICT (lead_id) DO UPDATE SET
         possui_socio=COALESCE(EXCLUDED.possui_socio,leads_qualificacao.possui_socio),
         interesse_ajuda=COALESCE(EXCLUDED.interesse_ajuda,leads_qualificacao.interesse_ajuda),
         updated_at=NOW()`, [id, finalPossuiSocio, finalInteresse]);
            await client.query(`INSERT INTO leads_financeiro (lead_id,tipo_divida,valor_divida_municipal,valor_divida_estadual,
         valor_divida_federal,valor_divida_ativa,calculo_parcelamento,tem_divida)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (lead_id) DO UPDATE SET
         tipo_divida=COALESCE(EXCLUDED.tipo_divida,leads_financeiro.tipo_divida),
         valor_divida_municipal=COALESCE(EXCLUDED.valor_divida_municipal,leads_financeiro.valor_divida_municipal),
         valor_divida_estadual=COALESCE(EXCLUDED.valor_divida_estadual,leads_financeiro.valor_divida_estadual),
         valor_divida_federal=COALESCE(EXCLUDED.valor_divida_federal,leads_financeiro.valor_divida_federal),
         valor_divida_ativa=COALESCE(EXCLUDED.valor_divida_ativa,leads_financeiro.valor_divida_ativa),
         calculo_parcelamento=COALESCE(EXCLUDED.calculo_parcelamento,leads_financeiro.calculo_parcelamento),
         tem_divida=COALESCE(EXCLUDED.tem_divida,leads_financeiro.tem_divida), updated_at=NOW()`, [id, tipo_divida, valor_divida_municipal, valor_divida_estadual,
                valor_divida_federal, valor_divida_ativa, calculo_parcelamento, !!tipo_divida]);
            await client.query(`INSERT INTO leads_atendimento (lead_id,observacoes,envio_disparo,data_controle_24h)
         VALUES ($1,$2,'a1',NOW()) ON CONFLICT (lead_id) DO UPDATE SET
         observacoes=COALESCE(EXCLUDED.observacoes,leads_atendimento.observacoes),
         envio_disparo='a1', data_controle_24h=NOW(), updated_at=NOW()`, [id, observacoes]);
            if (data_reuniao) {
                await client.query(`INSERT INTO leads_vendas (lead_id,data_reuniao,status_atendimento,reuniao_agendada)
           VALUES ($1,$2,'reuniao',true) ON CONFLICT (lead_id) DO UPDATE SET
           data_reuniao=EXCLUDED.data_reuniao, status_atendimento='reuniao',
           reuniao_agendada=true, updated_at=NOW()`, [id, data_reuniao]);
            }
            await client.query('COMMIT');
            return id;
        });
        if (data_reuniao) {
            notifyMeetingAttendant(nome_completo || identifier, telefone || identifier, data_reuniao, observacoes);
        }
        const updated = await (0, db_1.query)(`${FULL_LEAD_SELECT} WHERE l.id = $1`, [leadId]);
        res.json(updated.rows[0]);
    }
    catch (err) {
        console.error('PUT /leads/user error:', err);
        res.status(500).json({ error: 'Internal Server Error', details: String(err) });
    }
});
// ---- GET /leads/unique-values ----
router.get('/leads/unique-values', async (req, res) => {
    const column = req.query.column;
    if (!column)
        return void res.status(400).json({ error: 'Column parameter is required' });
    const tableName = COLUMN_TABLE_MAP[column];
    if (!tableName)
        return void res.json({ values: [] });
    const realColumn = COLUMN_ALIAS_MAP[column] || column;
    if (!/^[a-zA-Z0-9_]+$/.test(realColumn))
        return void res.status(400).json({ error: 'Invalid column name' });
    try {
        const result = await (0, db_1.query)(`SELECT DISTINCT ${realColumn} AS value FROM ${tableName}
       WHERE ${realColumn} IS NOT NULL ORDER BY ${realColumn} ASC LIMIT 1000`);
        res.json({ values: result.rows.map((r) => r.value).filter(Boolean) });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch values' });
    }
});
// ---- POST /leads/bulk-update ----
router.post('/leads/bulk-update', async (req, res) => {
    const body = req.body;
    const column = body?.where?.column ?? body.column;
    const operator = body?.where?.operator ?? body.operator;
    const values = Array.isArray(body?.where?.values ?? body.values) ? (body?.where?.values ?? body.values) : [];
    const updateColumn = body?.update?.column ?? body.updateColumn ?? column;
    const updateAction = body?.update?.action ?? body.updateAction ?? (body?.update?.empty ? 'set_empty' : 'set_value');
    const updateValueRaw = body?.update?.value ?? body.updateValue;
    if (!column || !operator)
        return void res.status(400).json({ error: 'where.column e where.operator são obrigatórios' });
    const allowedUpdateColumns = {
        telefone: { col: 'telefone', type: 'text' }, nome_completo: { col: 'nome_completo', type: 'text' },
        razao_social: { col: 'razao_social', type: 'text' }, cnpj: { col: 'cnpj', type: 'text' },
        email: { col: 'email', type: 'text' }, observacoes: { col: 'observacoes', type: 'text' },
        calculo_parcelamento: { col: 'calculo_parcelamento', type: 'text' },
        atualizado_em: { col: 'updated_at', type: 'timestamp' },
        data_cadastro: { col: 'data_cadastro', type: 'timestamp' },
        data_controle_24h: { col: 'data_controle_24h', type: 'timestamp' },
        envio_disparo: { col: 'envio_disparo', type: 'text' },
        situacao: { col: 'situacao', type: 'text' }, qualificacao: { col: 'qualificacao', type: 'text' },
        motivo_qualificacao: { col: 'motivo_qualificacao', type: 'text' },
        interesse_ajuda: { col: 'interesse_ajuda', type: 'text' },
        valor_divida_ativa: { col: 'valor_divida_ativa', type: 'text' },
        valor_divida_municipal: { col: 'valor_divida_municipal', type: 'text' },
        valor_divida_estadual: { col: 'valor_divida_estadual', type: 'text' },
        valor_divida_federal: { col: 'valor_divida_federal', type: 'text' },
        cartao_cnpj: { col: 'cartao_cnpj', type: 'text' }, tipo_divida: { col: 'tipo_divida', type: 'text' },
        tipo_negocio: { col: 'tipo_negocio', type: 'text' }, faturamento_mensal: { col: 'faturamento_mensal', type: 'text' },
        possui_socio: { col: 'possui_socio', type: 'boolean' },
        pos_qualificacao: { col: 'pos_qualificacao', type: 'boolean' },
        servico_negociado: { col: 'servico_negociado', type: 'text' },
        data_ultima_consulta: { col: 'data_ultima_consulta', type: 'timestamp' },
        procuracao: { col: 'procuracao', type: 'boolean' },
        teria_interesse: { col: 'interesse_ajuda', type: 'text' },
        servico_escolhido: { col: 'servico_negociado', type: 'text' },
        data_reuniao: { col: 'data_reuniao', type: 'timestamp' },
    };
    const updateTableName = COLUMN_TABLE_MAP[updateColumn];
    if (!updateTableName)
        return void res.status(400).json({ error: 'Coluna de atualização inválida ou não mapeada' });
    const dbUpdate = allowedUpdateColumns[updateColumn];
    if (!dbUpdate)
        return void res.status(400).json({ error: 'Coluna de atualização não permitida' });
    const targetAlias = TABLE_ALIAS_MAP[updateTableName];
    const whereTableName = COLUMN_TABLE_MAP[column] || 'leads';
    const whereAlias = TABLE_ALIAS_MAP[whereTableName];
    const whereColReal = COLUMN_ALIAS_MAP[column] || column;
    const whereColQualified = `${whereAlias}.${whereColReal}`;
    const params = [];
    let setSql = '';
    if (updateAction === 'set_empty') {
        setSql = `SET ${dbUpdate.col} = NULL`;
    }
    else if (updateAction === 'toggle_boolean') {
        if (dbUpdate.type !== 'boolean')
            return void res.status(400).json({ error: 'Toggle booleano só é válido para colunas booleanas' });
        setSql = `SET ${dbUpdate.col} = NOT COALESCE(${targetAlias}.${dbUpdate.col}::boolean, FALSE)`;
    }
    else {
        if (updateValueRaw === undefined || updateValueRaw === null)
            return void res.status(400).json({ error: 'Informe o novo valor para set_value' });
        const cast = dbUpdate.type === 'boolean' ? '::boolean' : dbUpdate.type === 'timestamp' ? '::timestamp' : '';
        setSql = `SET ${dbUpdate.col} = $1${cast}`;
        params.push(String(updateValueRaw));
    }
    setSql += `, updated_at = NOW()`;
    let whereSql = '';
    const whereParams = [];
    switch (operator) {
        case 'in':
            whereSql = `${whereColQualified}::text = ANY($${params.length + 1})`;
            whereParams.push(values);
            break;
        case 'not_in':
            whereSql = `NOT (${whereColQualified}::text = ANY($${params.length + 1})) OR ${whereColQualified} IS NULL`;
            whereParams.push(values);
            break;
        case 'is_empty':
            whereSql = `${whereColQualified} IS NULL OR ${whereColQualified}::text = ''`;
            break;
        case 'is_not_empty':
            whereSql = `${whereColQualified} IS NOT NULL AND ${whereColQualified}::text <> ''`;
            break;
        default: return void res.status(400).json({ error: 'Operador inválido' });
    }
    let sql = '';
    if (updateTableName === whereTableName) {
        sql = `UPDATE ${updateTableName} ${targetAlias} ${setSql} WHERE ${whereSql}`;
    }
    else {
        let joinCondition = '';
        if (updateTableName === 'leads')
            joinCondition = `${targetAlias}.id = ${whereAlias}.lead_id`;
        else if (whereTableName === 'leads')
            joinCondition = `${targetAlias}.lead_id = ${whereAlias}.id`;
        else
            joinCondition = `${targetAlias}.lead_id = ${whereAlias}.lead_id`;
        sql = `UPDATE ${updateTableName} ${targetAlias} ${setSql} FROM ${whereTableName} ${whereAlias} WHERE ${joinCondition} AND ${whereSql}`;
    }
    try {
        const result = await (0, db_1.query)(sql, [...params, ...whereParams]);
        res.json({ success: true, updated: result.rowCount });
    }
    catch (err) {
        console.error('Bulk update error:', err);
        res.status(500).json({ error: String(err) });
    }
});
// ---- POST /leads/bulk-delete ----
router.post('/leads/bulk-delete', async (req, res) => {
    const body = req.body;
    if (body.qualification !== undefined) {
        const qual = body.qualification;
        let sql = '';
        let params = [];
        if (qual === 'vazio') {
            sql = `DELETE FROM leads l USING leads_qualificacao lq WHERE l.id = lq.lead_id AND (lq.qualificacao IS NULL OR lq.qualificacao = '')`;
        }
        else {
            sql = `DELETE FROM leads l USING leads_qualificacao lq WHERE l.id = lq.lead_id AND lq.qualificacao = $1`;
            params = [qual];
        }
        try {
            const result = await (0, db_1.query)(sql, params);
            return void res.json({ success: true, deleted: result.rowCount });
        }
        catch (err) {
            return void res.status(500).json({ error: String(err) });
        }
    }
    const column = body.column;
    const operator = body.operator;
    const values = Array.isArray(body.values) ? body.values : [];
    if (!column || !operator)
        return void res.status(400).json({ error: 'column e operator são obrigatórios' });
    if ((operator === 'in' || operator === 'not_in') && values.length === 0) {
        return void res.status(400).json({ error: 'values é obrigatório para operadores in/not_in' });
    }
    const whereTableName = COLUMN_TABLE_MAP[column] || 'leads';
    const whereColReal = COLUMN_ALIAS_MAP[column] || column;
    const targetAlias = whereTableName === 'leads' ? 'l' : 't';
    const colRef = `${targetAlias}.${whereColReal}`;
    let whereClause = '';
    let params = [];
    switch (operator) {
        case 'in':
            whereClause = `${colRef}::text = ANY($1)`;
            params = [values];
            break;
        case 'not_in':
            whereClause = `NOT (${colRef}::text = ANY($1)) OR ${colRef} IS NULL`;
            params = [values];
            break;
        case 'is_empty':
            whereClause = `${colRef} IS NULL OR ${colRef}::text = ''`;
            break;
        case 'is_not_empty':
            whereClause = `${colRef} IS NOT NULL AND ${colRef}::text <> ''`;
            break;
        default: return void res.status(400).json({ error: 'Operador inválido' });
    }
    const sql = whereTableName === 'leads'
        ? `DELETE FROM leads l WHERE ${whereClause}`
        : `DELETE FROM leads l USING ${whereTableName} t WHERE l.id = t.lead_id AND ${whereClause}`;
    try {
        const result = await (0, db_1.query)(sql, params);
        res.json({ success: true, deleted: result.rowCount });
    }
    catch (err) {
        console.error('Bulk delete error:', err);
        res.status(500).json({ error: String(err) });
    }
});
// ---- POST /leads/delete (Server Action proxy) ----
router.post('/leads/delete', async (req, res) => {
    const { telefone } = req.body;
    if (!telefone)
        return void res.status(400).json({ success: false, message: 'Telefone é obrigatório' });
    try {
        await (0, db_1.query)('DELETE FROM leads WHERE telefone = $1', [telefone]);
        res.json({ success: true, message: 'Lead excluído com sucesso' });
    }
    catch (err) {
        console.error('Delete lead error:', err);
        res.status(500).json({ success: false, message: 'Erro ao excluir lead' });
    }
});
// ---- PUT /leads/update-fields (Server Action proxy) ----
router.put('/leads/update-fields', async (req, res) => {
    const { telefone, updates } = req.body;
    if (!telefone || !updates)
        return void res.status(400).json({ success: false, message: 'telefone e updates são obrigatórios' });
    const allowedColumns = new Set([
        'telefone', 'nome_completo', 'email', 'senha_gov', 'nome_mae', 'cpf', 'data_nascimento',
        'cnpj', 'razao_social', 'nome_fantasia', 'tipo_negocio', 'faturamento_mensal', 'endereco',
        'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep', 'dados_serpro', 'cartao_cnpj',
        'situacao', 'qualificacao', 'motivo_qualificacao', 'interesse_ajuda', 'pos_qualificacao',
        'possui_socio', 'confirmacao_qualificacao', 'tem_divida', 'tipo_divida', 'valor_divida_municipal',
        'valor_divida_estadual', 'valor_divida_federal', 'valor_divida_ativa', 'tempo_divida',
        'calculo_parcelamento', 'servico_negociado', 'status_atendimento', 'data_reuniao', 'procuracao',
        'procuracao_ativa', 'procuracao_validade', 'servico_escolhido', 'reuniao_agendada', 'cliente',
        'atendente_id', 'envio_disparo', 'data_controle_24h', 'data_ultima_consulta', 'observacoes',
    ]);
    const updateTableMap = {
        nome_completo: 'leads', email: 'leads', cpf: 'leads', data_nascimento: 'leads',
        nome_mae: 'leads', senha_gov: 'leads', telefone: 'leads',
        cnpj: 'leads_empresarial', razao_social: 'leads_empresarial', nome_fantasia: 'leads_empresarial',
        tipo_negocio: 'leads_empresarial', faturamento_mensal: 'leads_empresarial', endereco: 'leads_empresarial',
        numero: 'leads_empresarial', complemento: 'leads_empresarial', bairro: 'leads_empresarial',
        cidade: 'leads_empresarial', estado: 'leads_empresarial', cep: 'leads_empresarial',
        dados_serpro: 'leads_empresarial', cartao_cnpj: 'leads_empresarial',
        situacao: 'leads_qualificacao', qualificacao: 'leads_qualificacao', motivo_qualificacao: 'leads_qualificacao',
        interesse_ajuda: 'leads_qualificacao', pos_qualificacao: 'leads_qualificacao', possui_socio: 'leads_qualificacao',
        confirmacao_qualificacao: 'leads_qualificacao',
        tem_divida: 'leads_financeiro', tipo_divida: 'leads_financeiro', valor_divida_municipal: 'leads_financeiro',
        valor_divida_estadual: 'leads_financeiro', valor_divida_federal: 'leads_financeiro',
        valor_divida_ativa: 'leads_financeiro', tempo_divida: 'leads_financeiro', calculo_parcelamento: 'leads_financeiro',
        servico_negociado: 'leads_vendas', status_atendimento: 'leads_vendas', data_reuniao: 'leads_vendas',
        procuracao: 'leads_vendas', procuracao_ativa: 'leads_vendas', procuracao_validade: 'leads_vendas',
        servico_escolhido: 'leads_vendas', reuniao_agendada: 'leads_vendas', cliente: 'leads_vendas',
        atendente_id: 'leads_atendimento', envio_disparo: 'leads_atendimento', data_controle_24h: 'leads_atendimento',
        data_ultima_consulta: 'leads_atendimento', observacoes: 'leads_atendimento',
    };
    const booleanColumns = new Set(['possui_socio', 'pos_qualificacao', 'procuracao', 'tem_divida', 'procuracao_ativa', 'confirmacao_qualificacao', 'reuniao_agendada', 'cliente']);
    const dateColumns = new Set(['data_reuniao', 'data_cadastro', 'data_controle_24h', 'data_ultima_consulta', 'procuracao_validade', 'data_nascimento']);
    const entries = Object.entries(updates).filter(([k]) => allowedColumns.has(k));
    if (entries.length === 0)
        return void res.status(400).json({ success: false, message: 'Nenhum campo válido para atualizar' });
    const normalized = entries.map(([k, v]) => {
        let value = v;
        if (booleanColumns.has(k))
            value = typeof v === 'string' ? ['sim', 'true', '1'].includes(v.trim().toLowerCase()) : !!v;
        if (dateColumns.has(k) && typeof v === 'string') {
            const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)
                ? new Date(v)
                : new Date(v);
            value = isNaN(d.getTime()) ? v : d.toISOString();
        }
        return { key: k, value, table: updateTableMap[k] };
    });
    const updatesByTable = {};
    normalized.forEach(({ key, value, table }) => {
        if (!table)
            return;
        if (!updatesByTable[table])
            updatesByTable[table] = { keys: [], values: [] };
        updatesByTable[table].keys.push(key);
        updatesByTable[table].values.push(value);
    });
    try {
        await (0, db_1.withClient)(async (client) => {
            await client.query('BEGIN');
            const leadRes = await client.query('SELECT id FROM leads WHERE telefone = $1', [telefone]);
            if (leadRes.rowCount === 0)
                throw new Error('Lead not found');
            const leadId = leadRes.rows[0].id;
            for (const [table, data] of Object.entries(updatesByTable)) {
                const setClauses = data.keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
                if (table === 'leads') {
                    await client.query(`UPDATE leads SET ${setClauses}, atualizado_em=NOW() WHERE id=$1`, [leadId, ...data.values]);
                }
                else {
                    const columns = ['lead_id', ...data.keys].join(', ');
                    const placeholders = ['$1', ...data.keys.map((_, i) => `$${i + 2}`)].join(', ');
                    const updateSet = data.keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
                    await client.query(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})
             ON CONFLICT (lead_id) DO UPDATE SET ${updateSet}, updated_at=NOW()`, [leadId, ...data.values]);
                }
            }
            await client.query('COMMIT');
        });
        res.json({ success: true, message: 'Ficha atualizada com sucesso' });
    }
    catch (err) {
        console.error('update-fields error:', err);
        res.status(500).json({ success: false, message: 'Erro ao atualizar ficha' });
    }
});
exports.default = router;
//# sourceMappingURL=leads.js.map