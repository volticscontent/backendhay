import { Router, Request, Response } from 'express';
import { query } from '../../lib/db';

const router = Router();

const PRESETS: Record<string, string[]> = {
    mei:       ['PGMEI', 'CCMEI_DADOS', 'CAIXAPOSTAL'],
    simples:   ['PGDASD', 'DEFIS', 'PARCELAMENTO_SN_CONSULTAR', 'CND', 'CAIXAPOSTAL'],
    presumido: ['DCTFWEB', 'SICALC', 'SITFIS', 'CND', 'CAIXAPOSTAL'],
    real:      ['DCTFWEB', 'SICALC', 'SITFIS', 'CND', 'CAIXAPOSTAL'],
};

// GET /integra/empresas
router.get('/integra/empresas', async (_req: Request, res: Response) => {
    const result = await query(
        `SELECT id, cnpj, razao_social, regime_tributario, ativo,
                servicos_habilitados, lead_id, certificado_validade, observacoes,
                created_at, updated_at
         FROM integra_empresas
         ORDER BY razao_social ASC`
    );
    res.json(result.rows);
});

// GET /integra/empresas/:id
router.get('/integra/empresas/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await query(
        `SELECT * FROM integra_empresas WHERE id = $1`,
        [id]
    );
    if (result.rows.length === 0) return void res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(result.rows[0]);
});

// POST /integra/empresas
router.post('/integra/empresas', async (req: Request, res: Response) => {
    const { cnpj, razao_social, regime_tributario = 'mei', ativo = true,
            servicos_habilitados, lead_id, certificado_validade, observacoes } = req.body as {
        cnpj: string; razao_social: string; regime_tributario?: string;
        ativo?: boolean; servicos_habilitados?: string[];
        lead_id?: number; certificado_validade?: string; observacoes?: string;
    };

    if (!cnpj || !razao_social) {
        return void res.status(400).json({ error: 'cnpj e razao_social são obrigatórios' });
    }

    const servicos = servicos_habilitados ?? PRESETS[regime_tributario] ?? PRESETS.mei;

    const result = await query(
        `INSERT INTO integra_empresas
           (cnpj, razao_social, regime_tributario, ativo, servicos_habilitados, lead_id, certificado_validade, observacoes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [cnpj, razao_social, regime_tributario, ativo, JSON.stringify(servicos), lead_id ?? null, certificado_validade ?? null, observacoes ?? null]
    );
    res.status(201).json(result.rows[0]);
});

// PATCH /integra/empresas/:id
router.patch('/integra/empresas/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const fields = req.body as Record<string, unknown>;

    const allowed = ['razao_social', 'regime_tributario', 'ativo', 'servicos_habilitados',
                     'lead_id', 'certificado_validade', 'observacoes'];
    const updates: string[] = [];
    const values: unknown[] = [];

    for (const key of allowed) {
        if (key in fields) {
            values.push(key === 'servicos_habilitados' ? JSON.stringify(fields[key]) : fields[key]);
            updates.push(`${key} = $${values.length}`);
        }
    }

    if (updates.length === 0) return void res.status(400).json({ error: 'Nenhum campo válido para atualizar' });

    values.push(id);
    const result = await query(
        `UPDATE integra_empresas SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length} RETURNING *`,
        values
    );

    if (result.rows.length === 0) return void res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(result.rows[0]);
});

// DELETE /integra/empresas/:id
router.delete('/integra/empresas/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await query(`DELETE FROM integra_empresas WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) return void res.status(404).json({ error: 'Empresa não encontrada' });
    res.json({ deleted: true });
});

// GET /integra/empresas/presets/:regime — retorna preset de serviços
router.get('/integra/presets/:regime', (req: Request, res: Response) => {
    const { regime } = req.params;
    const preset = PRESETS[regime as keyof typeof PRESETS];
    if (!preset) return void res.status(400).json({ error: 'Regime inválido' });
    res.json(preset);
});

export default router;
