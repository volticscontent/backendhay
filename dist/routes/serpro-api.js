"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const serpro_1 = require("../lib/serpro");
const serpro_db_1 = require("../lib/serpro-db");
const r2_1 = require("../lib/r2");
const router = (0, express_1.Router)();
// POST /serpro — consult a CNPJ
router.post('/serpro', async (req, res) => {
    const { cnpj, service, ano, mes, numeroRecibo, codigoReceita, categoria, protocoloRelatorio, cpf } = req.body;
    if (!cnpj)
        return void res.status(400).json({ error: 'CNPJ é obrigatório' });
    const target = service || 'CCMEI_DADOS';
    const options = { ano, mes, numeroRecibo, codigoReceita, categoria, protocoloRelatorio, cpf };
    try {
        const result = await (0, serpro_1.consultarServico)(target, cnpj, options);
        let finalResult = result;
        if (target === 'CCMEI_DADOS' && result && typeof result === 'object') {
            const r = result;
            const mensagens = (Array.isArray(r.mensagens) ? r.mensagens : []);
            const hasNaoMei = mensagens.some((m) => String(m.texto || '').toLowerCase().includes('não possui mais a condição de mei') ||
                String(m.codigo || '').includes('CCMEI-BSN-0020'));
            if (hasNaoMei) {
                const pgmei = await (0, serpro_1.consultarServico)('PGMEI', cnpj, options);
                finalResult = { primary: result, fallback: pgmei };
            }
        }
        (0, serpro_db_1.saveConsultation)(cnpj, target, finalResult, 200, 'admin');
        res.json(finalResult);
    }
    catch (err) {
        console.error('SERPRO API Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Erro interno' });
    }
});
// GET /serpro/clients — last consulted clients
router.get('/serpro/clients', async (req, res) => {
    const source = req.query.source;
    const ALLOWED_SOURCES = new Set(['admin', 'bot']);
    const safeSource = source && ALLOWED_SOURCES.has(source) ? source : null;
    const sourceCondition = safeSource ? `WHERE source = $1` : '';
    const queryParams = safeSource ? [safeSource] : [];
    const betterQuery = `
    WITH LatestConsultations AS (
      SELECT cnpj, MAX(created_at) AS last_consultation_date FROM consultas_serpro ${sourceCondition} GROUP BY cnpj
    )
    SELECT
      lc.cnpj AS raw_cnpj, lc.last_consultation_date AS created_at, c.resultado,
      l.id AS lead_id, l.nome_completo, l.telefone, l.email,
      (COALESCE(lp.procuracao, false) OR COALESCE(lp.procuracao_ativa, false) OR (c.resultado IS NOT NULL)) AS procuracao_ativa,
      lp.procuracao_validade
    FROM LatestConsultations lc
    JOIN consultas_serpro c ON c.cnpj = lc.cnpj AND c.created_at = lc.last_consultation_date
    LEFT JOIN leads l ON LTRIM(REGEXP_REPLACE(l.cnpj, '[^0-9]', '', 'g'), '0') = LTRIM(REGEXP_REPLACE(lc.cnpj, '[^0-9]', '', 'g'), '0')
    LEFT JOIN leads_processo lp ON l.id = lp.lead_id
    ORDER BY lc.last_consultation_date DESC LIMIT 20
  `;
    try {
        const result = await (0, db_1.query)(betterQuery, queryParams);
        const clients = result.rows.map((row) => {
            let nome = row.nome_completo || 'Nome não disponível';
            if (!row.nome_completo && row.resultado) {
                try {
                    const resData = row.resultado;
                    if (resData.dados && typeof resData.dados === 'string') {
                        const parsed = JSON.parse(resData.dados);
                        const emp = parsed.empresario;
                        nome = String(parsed.nomeEmpresarial || emp?.nomeCivil || nome);
                    }
                    else if (resData.ni) {
                        nome = String(resData.nome || nome);
                    }
                }
                catch { /* ignore parse errors */ }
            }
            return {
                id: row.lead_id || row.raw_cnpj,
                nome, cnpj: row.raw_cnpj, telefone: row.telefone, email: row.email,
                data_ultima_consulta: row.created_at,
                procuracao_ativa: !!row.procuracao_ativa,
                procuracao_validade: row.procuracao_validade,
            };
        });
        res.json(clients);
    }
    catch (err) {
        console.error('Error fetching serpro clients:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /serpro/history?cnpj=... — consultation history
router.get('/serpro/history', async (req, res) => {
    const cnpj = req.query.cnpj;
    if (!cnpj)
        return void res.status(400).json({ error: 'CNPJ is required' });
    const cleanCnpj = cnpj.replace(/\D/g, '');
    try {
        const result = await (0, db_1.query)(`SELECT id, tipo_servico, resultado, status, source, created_at
       FROM consultas_serpro WHERE cnpj = $1 ORDER BY created_at DESC`, [cleanCnpj]);
        res.json(result.rows);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /serpro/carteira — portfolio view: leads with CNPJ + document status per service
router.get('/serpro/carteira', async (req, res) => {
    const servicos = ['SIT_FISCAL_RELATORIO', 'CND', 'PGMEI_EXTRATO'];
    try {
        const leadsResult = await (0, db_1.query)(`
      SELECT
        l.id AS lead_id, l.nome_completo, l.telefone, l.email,
        REGEXP_REPLACE(l.cnpj, '[^0-9]', '', 'g') AS cnpj,
        COALESCE(lp.procuracao_ativa, lp.procuracao, false) AS procuracao_ativa,
        lp.procuracao_validade
      FROM leads l
      LEFT JOIN leads_processo lp ON l.id = lp.lead_id
      WHERE l.cnpj IS NOT NULL AND l.cnpj != ''
      ORDER BY l.nome_completo ASC
      LIMIT 200
    `);
        const cnpjs = leadsResult.rows.map((r) => r.cnpj).filter(Boolean);
        if (cnpjs.length === 0)
            return void res.json([]);
        const docsResult = await (0, db_1.query)(`
      SELECT DISTINCT ON (cnpj, tipo_servico)
        cnpj, tipo_servico, r2_url, valido_ate, created_at, id
      FROM serpro_documentos
      WHERE cnpj = ANY($1) AND deletado_em IS NULL
      ORDER BY cnpj, tipo_servico, created_at DESC
    `, [cnpjs]);
        const docsMap = {};
        for (const doc of docsResult.rows) {
            const docCnpj = doc.cnpj;
            const docTipo = doc.tipo_servico;
            if (!docsMap[docCnpj])
                docsMap[docCnpj] = {};
            docsMap[docCnpj][docTipo] = { r2_url: doc.r2_url, valido_ate: doc.valido_ate, created_at: doc.created_at, id: doc.id };
        }
        const now = new Date();
        const portfolio = leadsResult.rows.map((lead) => {
            const cnpj = lead.cnpj;
            const documentos = {};
            for (const svc of servicos) {
                const doc = docsMap[cnpj]?.[svc];
                if (!doc) {
                    documentos[svc] = { status: 'NAO_GERADO' };
                }
                else {
                    const expired = doc.valido_ate ? new Date(doc.valido_ate) < now : false;
                    documentos[svc] = {
                        status: expired ? 'EXPIRADO' : 'GERADO',
                        r2_url: doc.r2_url,
                        valido_ate: doc.valido_ate,
                        created_at: doc.created_at,
                        id: doc.id,
                    };
                }
            }
            return {
                lead_id: lead.lead_id,
                nome: lead.nome_completo,
                telefone: lead.telefone,
                email: lead.email,
                cnpj,
                procuracao_ativa: lead.procuracao_ativa,
                procuracao_validade: lead.procuracao_validade,
                documentos,
            };
        });
        res.json(portfolio);
    }
    catch (err) {
        console.error('Erro ao buscar carteira:', err);
        res.status(500).json({ error: 'Erro interno' });
    }
});
// GET /serpro/documentos — list fiscal documents (GED)
router.get('/serpro/documentos', async (req, res) => {
    try {
        const { cnpj, tipo_servico, gerado_por, limit, offset } = req.query;
        const docs = await (0, serpro_db_1.listDocumentos)({
            cnpj,
            tipo_servico,
            gerado_por,
            limit: limit ? parseInt(limit, 10) : 50,
            offset: offset ? parseInt(offset, 10) : 0,
        });
        res.json(docs);
    }
    catch (err) {
        console.error('Erro ao listar documentos Serpro:', err);
        res.status(500).json({ error: 'Erro interno' });
    }
});
// POST /serpro/documentos — save document metadata after R2 upload
router.post('/serpro/documentos', async (req, res) => {
    const { cnpj, tipo_servico, protocolo, r2_key, r2_url, tamanho_bytes, valido_ate, gerado_por, lead_id, metadata } = req.body;
    if (!cnpj || !tipo_servico || !r2_key || !r2_url) {
        return void res.status(400).json({ error: 'cnpj, tipo_servico, r2_key e r2_url são obrigatórios' });
    }
    try {
        const saved = await (0, serpro_db_1.saveDocumento)({ cnpj, tipo_servico, protocolo, r2_key, r2_url, tamanho_bytes, valido_ate, gerado_por, lead_id, metadata });
        res.status(201).json({ id: saved.id, valido_ate: saved.valido_ate });
    }
    catch (err) {
        console.error('Erro ao salvar documento Serpro:', err);
        res.status(500).json({ error: 'Erro interno' });
    }
});
// DELETE /serpro/documentos/:id — soft delete
router.delete('/serpro/documentos/:id', async (req, res) => {
    const id = req.params['id'];
    try {
        const deleted = await (0, serpro_db_1.softDeleteDocumento)(id);
        if (!deleted)
            return void res.status(404).json({ error: 'Documento não encontrado' });
        res.json({ success: true });
    }
    catch (err) {
        console.error('Erro ao deletar documento Serpro:', err);
        res.status(500).json({ error: 'Erro interno' });
    }
});
// GET /serpro/documentos/:id/download — presigned URL for secure PDF download
router.get('/serpro/documentos/:id/download', async (req, res) => {
    const id = req.params['id'];
    try {
        const result = await (0, db_1.query)(`SELECT r2_key FROM serpro_documentos WHERE id = $1 AND deletado_em IS NULL`, [id]);
        if (!result.rows[0])
            return void res.status(404).json({ error: 'Documento não encontrado' });
        const presignedUrl = await (0, r2_1.getPresignedDownloadUrl)(result.rows[0].r2_key);
        res.json({ url: presignedUrl });
    }
    catch (err) {
        console.error('Erro ao gerar presigned URL:', err);
        res.status(500).json({ error: 'Erro interno' });
    }
});
// PUT /serpro/procuracao/:leadId — toggle procuração status (admin only)
router.put('/serpro/procuracao/:leadId', async (req, res) => {
    const leadId = parseInt(req.params['leadId'], 10);
    if (isNaN(leadId))
        return void res.status(400).json({ error: 'leadId inválido' });
    const { ativo } = req.body;
    if (typeof ativo !== 'boolean')
        return void res.status(400).json({ error: 'ativo (boolean) é obrigatório' });
    try {
        const validoAte = ativo ? new Date(Date.now() + 365 * 86_400_000).toISOString() : null;
        await (0, db_1.query)(`
      INSERT INTO leads_processo (lead_id, procuracao, procuracao_ativa, procuracao_validade, updated_at)
      VALUES ($1, $2, $2, $3, NOW())
      ON CONFLICT (lead_id) DO UPDATE SET
        procuracao = $2,
        procuracao_ativa = $2,
        procuracao_validade = $3,
        updated_at = NOW()
    `, [leadId, ativo, validoAte]);
        res.json({ success: true, procuracao_ativa: ativo, procuracao_validade: validoAte });
    }
    catch (err) {
        console.error('Erro ao atualizar procuração:', err);
        res.status(500).json({ error: 'Erro interno' });
    }
});
// GET /serpro/health — auth health check
router.get('/serpro/health', async (_req, res) => {
    try {
        const start = Date.now();
        await (0, serpro_1.getSerproTokens)();
        res.json({ status: 'success', latency: Date.now() - start, data: { status: 'Operacional' }, timestamp: new Date().toISOString() });
    }
    catch (err) {
        res.status(500).json({ status: 'error', message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() });
    }
});
exports.default = router;
//# sourceMappingURL=serpro-api.js.map