"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const serpro_1 = require("../lib/serpro");
const serpro_db_1 = require("../lib/serpro-db");
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
    const sourceCondition = source ? `WHERE source = '${source.replace(/'/g, "''")}'` : '';
    const betterQuery = `
    WITH LatestConsultations AS (
      SELECT cnpj, MAX(created_at) AS last_consultation_date FROM consultas_serpro ${sourceCondition} GROUP BY cnpj
    )
    SELECT
      lc.cnpj AS raw_cnpj, lc.last_consultation_date AS created_at, c.resultado,
      l.id AS lead_id, l.nome_completo, l.telefone, l.email,
      (COALESCE(lv.procuracao, false) OR COALESCE(lv.procuracao_ativa, false) OR (c.resultado IS NOT NULL)) AS procuracao_ativa,
      lv.procuracao_validade
    FROM LatestConsultations lc
    JOIN consultas_serpro c ON c.cnpj = lc.cnpj AND c.created_at = lc.last_consultation_date
    LEFT JOIN leads_empresarial le ON LTRIM(REGEXP_REPLACE(le.cnpj, '[^0-9]', '', 'g'), '0') = LTRIM(REGEXP_REPLACE(lc.cnpj, '[^0-9]', '', 'g'), '0')
    LEFT JOIN leads l ON le.lead_id = l.id
    LEFT JOIN leads_vendas lv ON l.id = lv.lead_id
    ORDER BY lc.last_consultation_date DESC LIMIT 20
  `;
    try {
        const result = await (0, db_1.query)(betterQuery);
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