import { Router, Request, Response } from 'express';
import { query } from '../../lib/db';

const router = Router();

// GET /integra/billing?mes=YYYY-MM
// Agrega consumo + custo estimado por empresa e serviço no mês informado
router.get('/integra/billing', async (req: Request, res: Response) => {
    const mes = (req.query.mes as string) || new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    const [ano, mesNum] = mes.split('-').map(Number);
    if (!ano || !mesNum) return void res.status(400).json({ error: 'Formato mes inválido. Use YYYY-MM' });

    const inicioMes = new Date(ano, mesNum - 1, 1).toISOString();
    const fimMes   = new Date(ano, mesNum, 1).toISOString();

    try {
        // Detalhes por empresa + robô
        const detalhe = await query(`
            SELECT
                e.id          AS empresa_id,
                e.cnpj,
                e.razao_social,
                ex.robo_tipo,
                COUNT(ei.id)  AS consultas,
                p.preco_unitario,
                COUNT(ei.id) * COALESCE(p.preco_unitario, 0) AS custo_total
            FROM integra_execucao_itens ei
            JOIN integra_execucoes ex ON ex.id = ei.execucao_id
            JOIN integra_empresas  e  ON e.id  = ei.empresa_id
            LEFT JOIN integra_precos p ON p.tipo_robo = ex.robo_tipo
            WHERE ei.status = 'success'
              AND ex.iniciado_em >= $1
              AND ex.iniciado_em <  $2
            GROUP BY e.id, e.cnpj, e.razao_social, ex.robo_tipo, p.preco_unitario
            ORDER BY e.razao_social, ex.robo_tipo
        `, [inicioMes, fimMes]);

        // Totais gerais do mês
        const totais = await query(`
            SELECT
                SUM(COUNT(ei.id))                                         AS total_consultas,
                SUM(COUNT(ei.id) * COALESCE(p.preco_unitario, 0))         AS custo_total
            FROM integra_execucao_itens ei
            JOIN integra_execucoes ex ON ex.id = ei.execucao_id
            LEFT JOIN integra_precos p ON p.tipo_robo = ex.robo_tipo
            WHERE ei.status = 'success'
              AND ex.iniciado_em >= $1
              AND ex.iniciado_em <  $2
        `, [inicioMes, fimMes]);

        // Preços vigentes
        const precos = await query(`SELECT * FROM integra_precos ORDER BY tipo_robo`);

        res.json({
            mes,
            totais: totais.rows[0],
            detalhe: detalhe.rows,
            precos: precos.rows,
        });
    } catch (err) {
        console.error('[billing]', err);
        res.status(500).json({ error: String(err) });
    }
});

// PATCH /integra/billing/precos/:tipo_robo — atualizar preço unitário
router.patch('/integra/billing/precos/:tipo_robo', async (req: Request, res: Response) => {
    const { preco_unitario } = req.body as { preco_unitario: number };
    if (preco_unitario == null || isNaN(preco_unitario)) {
        return void res.status(400).json({ error: 'preco_unitario numérico obrigatório' });
    }

    const result = await query(
        `UPDATE integra_precos
         SET preco_unitario = $1, updated_at = NOW()
         WHERE tipo_robo = $2
         RETURNING *`,
        [preco_unitario, req.params.tipo_robo]
    );
    if (!result.rows.length) return void res.status(404).json({ error: 'Tipo de robô não encontrado' });
    res.json(result.rows[0]);
});

export default router;
