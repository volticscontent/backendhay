"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../../lib/db");
const job_caixa_postal_1 = require("../../queues/integra/job-caixa-postal");
const router = (0, express_1.Router)();
// GET /integra/caixa-postal?empresa_id=&lida=&page=&limit=
router.get('/integra/caixa-postal', async (req, res) => {
    const { empresa_id, lida, page = '1', limit = '50' } = req.query;
    const conditions = [];
    const values = [];
    if (empresa_id) {
        values.push(Number(empresa_id));
        conditions.push(`m.empresa_id = $${values.length}`);
    }
    if (lida !== undefined) {
        values.push(lida === 'true');
        conditions.push(`m.lida = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);
    values.push(parseInt(limit), offset);
    const result = await (0, db_1.query)(`
        SELECT m.*, e.cnpj, e.razao_social
        FROM integra_caixa_postal m
        JOIN integra_empresas e ON e.id = m.empresa_id
        ${where}
        ORDER BY m.data_mensagem DESC NULLS LAST, m.created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
    res.json(result.rows);
});
// PATCH /integra/caixa-postal/:id/lida
router.patch('/integra/caixa-postal/:id/lida', async (req, res) => {
    const result = await (0, db_1.query)(`UPDATE integra_caixa_postal SET lida = true WHERE id = $1 RETURNING id, lida`, [req.params.id]);
    if (!result.rows.length)
        return void res.status(404).json({ error: 'Mensagem não encontrada' });
    res.json(result.rows[0]);
});
// POST /integra/caixa-postal/sincronizar — trigger manual
router.post('/integra/caixa-postal/sincronizar', async (_req, res) => {
    const exec = await (0, db_1.query)(`INSERT INTO integra_execucoes (robo_tipo, status) VALUES ('caixa_postal', 'running') RETURNING id`);
    await (0, job_caixa_postal_1.enqueueRoboCaixaPostal)(exec.rows[0].id);
    res.status(202).json({ execucao_id: exec.rows[0].id, message: 'Sincronização iniciada' });
});
exports.default = router;
//# sourceMappingURL=caixa-postal.js.map