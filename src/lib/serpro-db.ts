import pool from './db';

export async function saveConsultation(cnpj: string, service: string, result: unknown, status: number, source: string = 'bot') {
    try {
        const cleanCnpj = cnpj.replace(/\D/g, '');
        const query = `
      INSERT INTO consultas_serpro (cnpj, tipo_servico, resultado, status, source, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id
    `;
        const res = await pool.query(query, [cleanCnpj, service, result, status, source]);
        console.log(`[DB] Consulta Serpro salva. ID: ${res.rows[0].id}`);
    } catch (error) {
        console.error('[DB] Erro ao salvar consulta Serpro:', error);
    }
}
