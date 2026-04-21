import { Router, Request, Response } from 'express';
import { query } from '../../lib/db';
import { enqueueRoboCaixaPostal } from '../../queues/integra/job-caixa-postal';

const router = Router();

// GET /integra/caixa-postal?empresa_id=&lida=&page=&limit=
router.get('/integra/caixa-postal', async (req: Request, res: Response) => {
    const { empresa_id, lida, page = '1', limit = '50' } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (empresa_id) { values.push(Number(empresa_id)); conditions.push(`m.empresa_id = $${values.length}`); }
    if (lida !== undefined) { values.push(lida === 'true'); conditions.push(`m.lida = $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);
    values.push(parseInt(limit), offset);

    const result = await query(`
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
router.patch('/integra/caixa-postal/:id/lida', async (req: Request, res: Response) => {
    const result = await query(
        `UPDATE integra_caixa_postal SET lida = true WHERE id = $1 RETURNING id, lida`,
        [req.params.id]
    );
    if (!result.rows.length) return void res.status(404).json({ error: 'Mensagem não encontrada' });
    res.json(result.rows[0]);
});

// POST /integra/caixa-postal/sincronizar — trigger manual
router.post('/integra/caixa-postal/sincronizar', async (_req: Request, res: Response) => {
    const exec = await query(
        `INSERT INTO integra_execucoes (robo_tipo, status) VALUES ('caixa_postal', 'running') RETURNING id`
    );
    await enqueueRoboCaixaPostal(exec.rows[0].id as number);
    res.status(202).json({ execucao_id: exec.rows[0].id, message: 'Sincronização iniciada' });
});

export default router;
