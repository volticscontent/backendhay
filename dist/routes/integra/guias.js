"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../../lib/db");
const r2_1 = require("../../lib/r2");
const job_pgmei_1 = require("../../queues/integra/job-pgmei");
const job_cnd_1 = require("../../queues/integra/job-cnd");
const job_caixa_postal_1 = require("../../queues/integra/job-caixa-postal");
const router = (0, express_1.Router)();
// GET /integra/guias?empresa_id=&competencia=&tipo=&status=&page=&limit=
router.get('/integra/guias', async (req, res) => {
    const { empresa_id, competencia, tipo, status, page = '1', limit = '50' } = req.query;
    const conditions = [];
    const values = [];
    if (empresa_id) {
        values.push(Number(empresa_id));
        conditions.push(`g.empresa_id = $${values.length}`);
    }
    if (competencia) {
        values.push(competencia);
        conditions.push(`g.competencia = $${values.length}`);
    }
    if (tipo) {
        values.push(tipo);
        conditions.push(`g.tipo = $${values.length}`);
    }
    if (status) {
        values.push(status);
        conditions.push(`g.status_pagamento = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);
    values.push(parseInt(limit), offset);
    const result = await (0, db_1.query)(`
        SELECT
            g.*,
            e.cnpj, e.razao_social
        FROM integra_guias g
        JOIN integra_empresas e ON e.id = g.empresa_id
        ${where}
        ORDER BY g.created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
    res.json(result.rows);
});
// PATCH /integra/guias/:id — atualizar status_pagamento
router.patch('/integra/guias/:id', async (req, res) => {
    const { status_pagamento } = req.body;
    if (!status_pagamento)
        return void res.status(400).json({ error: 'status_pagamento obrigatório' });
    const result = await (0, db_1.query)(`UPDATE integra_guias SET status_pagamento = $1 WHERE id = $2 RETURNING *`, [status_pagamento, req.params.id]);
    if (!result.rows.length)
        return void res.status(404).json({ error: 'Guia não encontrada' });
    res.json(result.rows[0]);
});
// GET /integra/guias/:id/download — URL pré-assinada para PDF no R2
router.get('/integra/guias/:id/download', async (req, res) => {
    const result = await (0, db_1.query)(`SELECT pdf_r2_key FROM integra_guias WHERE id = $1`, [req.params.id]);
    if (!result.rows.length)
        return void res.status(404).json({ error: 'Guia não encontrada' });
    const key = result.rows[0].pdf_r2_key;
    if (!key)
        return void res.status(404).json({ error: 'PDF não disponível para esta guia' });
    try {
        const url = await (0, r2_1.getPresignedDownloadUrl)(key, 900); // 15 min
        res.json({ url, expires_in: 900 });
    }
    catch (err) {
        res.status(500).json({ error: 'Erro ao gerar URL de download', detail: String(err) });
    }
});
// POST /integra/guias/gerar — geração manual para uma empresa específica
router.post('/integra/guias/gerar', async (req, res) => {
    const { empresa_id, tipo_robo = 'pgmei' } = req.body;
    if (!empresa_id)
        return void res.status(400).json({ error: 'empresa_id obrigatório' });
    const roboTipo = (tipo_robo || 'pgmei').toLowerCase();
    const empresa = await (0, db_1.query)(`SELECT id FROM integra_empresas WHERE id = $1 AND ativo = true`, [empresa_id]);
    if (!empresa.rows.length)
        return void res.status(404).json({ error: 'Empresa não encontrada ou inativa' });
    const exec = await (0, db_1.query)(`INSERT INTO integra_execucoes (robo_tipo, status) VALUES ($1, 'running') RETURNING id`, [roboTipo]);
    const execucaoId = exec.rows[0].id;
    // Para geração manual, isolamos a execução APENAS para essa empresa_id
    if (roboTipo === 'pgmei') {
        await (0, job_pgmei_1.enqueueRoboPgmei)(execucaoId, empresa_id);
    }
    else if (roboTipo === 'cnd') {
        await (0, job_cnd_1.enqueueRoboCnd)(execucaoId, empresa_id);
    }
    else if (roboTipo === 'caixa_postal') {
        await (0, job_caixa_postal_1.enqueueRoboCaixaPostal)(execucaoId, empresa_id);
    }
    else {
        return void res.status(400).json({ error: `tipo_robo inválido: ${roboTipo}` });
    }
    res.status(202).json({ execucao_id: execucaoId, empresa_id, tipo_robo: roboTipo, message: 'Geração iniciada' });
});
exports.default = router;
//# sourceMappingURL=guias.js.map