import { Router, Request, Response } from 'express';
import { query } from '../../lib/db';

const router = Router();

// GET /integra/dashboard/summary
router.get('/integra/dashboard/summary', async (_req: Request, res: Response) => {
    try {
        const now = new Date();
        const mesAtual = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        const em30Dias = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const [
            empresas,
            guias,
            robos,
            certificadosVencendo,
            historicoRecente,
        ] = await Promise.all([
            query(`
                SELECT
                    COUNT(*) FILTER (WHERE ativo = true)  AS ativas,
                    COUNT(*) FILTER (WHERE ativo = false) AS inativas,
                    COUNT(*)                              AS total
                FROM integra_empresas
            `),
            query(`
                SELECT
                    COUNT(*) FILTER (WHERE competencia = $1)                                  AS geradas_mes,
                    COUNT(*) FILTER (WHERE status_pagamento = 'pendente')                      AS pendentes,
                    COUNT(*) FILTER (WHERE status_pagamento = 'vencido')                       AS vencidas,
                    COUNT(*) FILTER (WHERE status_pagamento = 'pago' AND competencia = $1)     AS pagas_mes
                FROM integra_guias
            `, [mesAtual]),
            query(`
                SELECT
                    r.*,
                    e.iniciado_em   AS ult_inicio,
                    e.concluido_em  AS ult_fim,
                    e.status        AS ult_status,
                    e.sucesso       AS ult_sucesso,
                    e.falhas        AS ult_falhas,
                    e.total_empresas AS ult_total
                FROM integra_robos r
                LEFT JOIN LATERAL (
                    SELECT * FROM integra_execucoes
                    WHERE robo_tipo = r.tipo_robo
                    ORDER BY iniciado_em DESC
                    LIMIT 1
                ) e ON true
                ORDER BY r.tipo_robo
            `),
            query(`
                SELECT id, cnpj, razao_social, certificado_validade
                FROM integra_empresas
                WHERE ativo = true
                  AND certificado_validade IS NOT NULL
                  AND certificado_validade <= $1
                ORDER BY certificado_validade ASC
            `, [em30Dias]),
            query(`
                SELECT robo_tipo, status, iniciado_em, concluido_em, sucesso, falhas
                FROM integra_execucoes
                ORDER BY iniciado_em DESC
                LIMIT 10
            `),
        ]);

        res.json({
            empresas: empresas.rows[0],
            guias: guias.rows[0],
            robos: robos.rows,
            certificados_vencendo: certificadosVencendo.rows,
            historico_recente: historicoRecente.rows,
        });
    } catch (err) {
        console.error('[dashboard/summary]', err);
        res.status(500).json({ error: String(err) });
    }
});

export default router;
