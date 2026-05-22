import { Router, Request, Response } from 'express';
import { query } from '../../lib/db';
import { getPresignedDownloadUrl } from '../../lib/r2';
import { enqueueRoboPgmei } from '../../queues/integra/job-pgmei';
import { enqueueRoboCnd } from '../../queues/integra/job-cnd';
import { enqueueRoboCaixaPostal } from '../../queues/integra/job-caixa-postal';

const router = Router();

// GET /integra/guias?empresa_id=&competencia=&tipo=&status=&page=&limit=
router.get('/integra/guias', async (req: Request, res: Response) => {
    const { empresa_id, competencia, tipo, status, page = '1', limit = '50' } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (empresa_id) { values.push(Number(empresa_id)); conditions.push(`g.empresa_id = $${values.length}`); }
    if (competencia) { values.push(competencia); conditions.push(`g.competencia = $${values.length}`); }
    if (tipo)       { values.push(tipo);       conditions.push(`g.tipo = $${values.length}`); }
    if (status)     { values.push(status);     conditions.push(`g.status_pagamento = $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);
    values.push(parseInt(limit), offset);

    const result = await query(`
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
router.patch('/integra/guias/:id', async (req: Request, res: Response) => {
    const { status_pagamento } = req.body as { status_pagamento: string };
    if (!status_pagamento) return void res.status(400).json({ error: 'status_pagamento obrigatório' });

    const result = await query(
        `UPDATE integra_guias SET status_pagamento = $1 WHERE id = $2 RETURNING *`,
        [status_pagamento, req.params.id]
    );
    if (!result.rows.length) return void res.status(404).json({ error: 'Guia não encontrada' });
    res.json(result.rows[0]);
});

// GET /integra/guias/:id/download — URL pré-assinada para PDF no R2
router.get('/integra/guias/:id/download', async (req: Request, res: Response) => {
    const result = await query(`SELECT pdf_r2_key FROM integra_guias WHERE id = $1`, [req.params.id]);
    if (!result.rows.length) return void res.status(404).json({ error: 'Guia não encontrada' });

    const key = result.rows[0].pdf_r2_key as string | null;
    if (!key) return void res.status(404).json({ error: 'PDF não disponível para esta guia' });

    try {
        const url = await getPresignedDownloadUrl(key, 900); // 15 min
        res.json({ url, expires_in: 900 });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao gerar URL de download', detail: String(err) });
    }
});

// POST /integra/guias/gerar — geração manual para uma empresa específica
router.post('/integra/guias/gerar', async (req: Request, res: Response) => {
    const { empresa_id, tipo_robo = 'pgmei' } = req.body as { empresa_id: number; tipo_robo?: string };
    if (!empresa_id) return void res.status(400).json({ error: 'empresa_id obrigatório' });
    const roboTipo = (tipo_robo || 'pgmei').toLowerCase();

    const empresa = await query(`SELECT id FROM integra_empresas WHERE id = $1 AND ativo = true`, [empresa_id]);
    if (!empresa.rows.length) return void res.status(404).json({ error: 'Empresa não encontrada ou inativa' });

    const exec = await query(
        `INSERT INTO integra_execucoes (robo_tipo, status) VALUES ($1, 'running') RETURNING id`,
        [roboTipo]
    );
    const execucaoId = exec.rows[0].id as number;

    // Para geração manual, isolamos a execução APENAS para essa empresa_id
    if (roboTipo === 'pgmei') {
        await enqueueRoboPgmei(execucaoId, empresa_id);
    } else if (roboTipo === 'cnd') {
        await enqueueRoboCnd(execucaoId, empresa_id);
    } else if (roboTipo === 'caixa_postal') {
        await enqueueRoboCaixaPostal(execucaoId, empresa_id);
    } else {
        return void res.status(400).json({ error: `tipo_robo inválido: ${roboTipo}` });
    }

    res.status(202).json({ execucao_id: execucaoId, empresa_id, tipo_robo: roboTipo, message: 'Geração iniciada' });
});

export default router;
