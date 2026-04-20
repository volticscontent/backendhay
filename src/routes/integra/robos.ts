import { Router, Request, Response } from 'express';
import { query } from '../../lib/db';

const router = Router();

// GET /integra/robos
router.get('/integra/robos', async (_req: Request, res: Response) => {
    const robos = await query(`SELECT * FROM integra_robos ORDER BY tipo_robo`);
    const execucoes = await query(
        `SELECT DISTINCT ON (robo_tipo) *
         FROM integra_execucoes
         ORDER BY robo_tipo, iniciado_em DESC`
    );

    const execucaoMap = new Map(execucoes.rows.map(e => [e.robo_tipo, e]));
    const data = robos.rows.map(r => ({
        ...r,
        ultima_execucao_detalhe: execucaoMap.get(r.tipo_robo) ?? null,
    }));

    res.json(data);
});

// PATCH /integra/robos/:tipo — ativar/desativar, alterar dia/hora
router.patch('/integra/robos/:tipo', async (req: Request, res: Response) => {
    const { tipo } = req.params;
    const { ativo, dia_execucao, hora_execucao } = req.body as {
        ativo?: boolean; dia_execucao?: number; hora_execucao?: string;
    };

    const updates: string[] = [];
    const values: unknown[] = [];

    if (ativo !== undefined)        { values.push(ativo);          updates.push(`ativo = $${values.length}`); }
    if (dia_execucao !== undefined)  { values.push(dia_execucao);   updates.push(`dia_execucao = $${values.length}`); }
    if (hora_execucao !== undefined) { values.push(hora_execucao);  updates.push(`hora_execucao = $${values.length}`); }

    if (updates.length === 0) return void res.status(400).json({ error: 'Nenhum campo válido' });

    values.push(tipo);
    const result = await query(
        `UPDATE integra_robos SET ${updates.join(', ')}, updated_at = NOW()
         WHERE tipo_robo = $${values.length} RETURNING *`,
        values
    );

    if (result.rows.length === 0) return void res.status(404).json({ error: 'Robô não encontrado' });
    res.json(result.rows[0]);
});

// POST /integra/robos/:tipo/executar — trigger manual (registra execução, worker real virá depois)
router.post('/integra/robos/:tipo/executar', async (req: Request, res: Response) => {
    const { tipo } = req.params;

    const robo = await query(`SELECT id FROM integra_robos WHERE tipo_robo = $1`, [tipo]);
    if (robo.rows.length === 0) return void res.status(404).json({ error: 'Robô não encontrado' });

    const exec = await query(
        `INSERT INTO integra_execucoes (robo_tipo, status)
         VALUES ($1, 'running') RETURNING id`,
        [tipo]
    );

    // TODO: enfileirar job BullMQ aqui (Fase 2)

    res.status(202).json({ execucao_id: exec.rows[0].id, message: 'Execução iniciada' });
});

// GET /integra/robos/:tipo/historico
router.get('/integra/robos/:tipo/historico', async (req: Request, res: Response) => {
    const { tipo } = req.params;
    const result = await query(
        `SELECT * FROM integra_execucoes WHERE robo_tipo = $1 ORDER BY iniciado_em DESC LIMIT 20`,
        [tipo]
    );
    res.json(result.rows);
});

export default router;
