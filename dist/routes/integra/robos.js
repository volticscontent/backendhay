"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../../lib/db");
const job_pgmei_1 = require("../../queues/integra/job-pgmei");
const job_cnd_1 = require("../../queues/integra/job-cnd");
const job_caixa_postal_1 = require("../../queues/integra/job-caixa-postal");
const ENQUEUE_MAP = {
    pgmei: job_pgmei_1.enqueueRoboPgmei,
    cnd: job_cnd_1.enqueueRoboCnd,
    caixa_postal: job_caixa_postal_1.enqueueRoboCaixaPostal,
};
const router = (0, express_1.Router)();
// GET /integra/robos
router.get('/integra/robos', async (_req, res) => {
    const robos = await (0, db_1.query)(`SELECT * FROM integra_robos ORDER BY tipo_robo`);
    const execucoes = await (0, db_1.query)(`SELECT DISTINCT ON (robo_tipo) *
         FROM integra_execucoes
         ORDER BY robo_tipo, iniciado_em DESC`);
    const execucaoMap = new Map(execucoes.rows.map(e => [e.robo_tipo, e]));
    const data = robos.rows.map(r => ({
        ...r,
        ultima_execucao_detalhe: execucaoMap.get(r.tipo_robo) ?? null,
    }));
    res.json(data);
});
// PATCH /integra/robos/:tipo — ativar/desativar, alterar dia/hora
router.patch('/integra/robos/:tipo', async (req, res) => {
    const { tipo } = req.params;
    const { ativo, dia_execucao, hora_execucao } = req.body;
    const updates = [];
    const values = [];
    if (ativo !== undefined) {
        values.push(ativo);
        updates.push(`ativo = $${values.length}`);
    }
    if (dia_execucao !== undefined) {
        values.push(dia_execucao);
        updates.push(`dia_execucao = $${values.length}`);
    }
    if (hora_execucao !== undefined) {
        values.push(hora_execucao);
        updates.push(`hora_execucao = $${values.length}`);
    }
    if (updates.length === 0)
        return void res.status(400).json({ error: 'Nenhum campo válido' });
    values.push(tipo);
    const result = await (0, db_1.query)(`UPDATE integra_robos SET ${updates.join(', ')}, updated_at = NOW()
         WHERE tipo_robo = $${values.length} RETURNING *`, values);
    if (result.rows.length === 0)
        return void res.status(404).json({ error: 'Robô não encontrado' });
    res.json(result.rows[0]);
});
// POST /integra/robos/:tipo/executar — trigger manual (registra execução, worker real virá depois)
router.post('/integra/robos/:tipo/executar', async (req, res) => {
    const { tipo } = req.params;
    const robo = await (0, db_1.query)(`SELECT id FROM integra_robos WHERE tipo_robo = $1`, [tipo]);
    if (robo.rows.length === 0)
        return void res.status(404).json({ error: 'Robô não encontrado' });
    const exec = await (0, db_1.query)(`INSERT INTO integra_execucoes (robo_tipo, status)
         VALUES ($1, 'running') RETURNING id`, [tipo]);
    const enqueue = ENQUEUE_MAP[tipo];
    if (enqueue)
        await enqueue(exec.rows[0].id);
    res.status(202).json({ execucao_id: exec.rows[0].id, message: 'Execução iniciada' });
});
// GET /integra/robos/:tipo/historico
router.get('/integra/robos/:tipo/historico', async (req, res) => {
    const { tipo } = req.params;
    const result = await (0, db_1.query)(`SELECT * FROM integra_execucoes WHERE robo_tipo = $1 ORDER BY iniciado_em DESC LIMIT 20`, [tipo]);
    res.json(result.rows);
});
exports.default = router;
//# sourceMappingURL=robos.js.map