import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import pool, { query } from '../lib/db';

const router = Router();

// GET /colaboradores
router.get('/colaboradores', async (req: Request, res: Response) => {
  try {
    const { cargo, ativo } = req.query;
    let sql = 'SELECT id, nome, email, telefone, cargo, permissoes, ativo, created_at, updated_at FROM colaboradores';
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (cargo && cargo !== 'todos') { conditions.push(`cargo = $${i++}`); values.push(cargo); }
    if (ativo !== undefined) { conditions.push(`ativo = $${i++}`); values.push(ativo === 'true'); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY ativo DESC, nome ASC';
    const { rows } = await query(sql, values);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Falha ao carregar colaboradores' });
  }
});

// POST /colaboradores
router.post('/colaboradores', async (req: Request, res: Response) => {
  const { nome, email, telefone, cargo, permissoes, senha } = req.body;
  if (!nome || !cargo || !email) return void res.status(400).json({ success: false, error: 'Nome, email e cargo são obrigatórios' });
  try {
    const senhaHash = senha ? await bcrypt.hash(senha, 10) : null;
    const { rows } = await pool.query(
      `INSERT INTO colaboradores (nome, email, telefone, cargo, permissoes, senha_hash)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nome, email, telefone, cargo, permissoes, ativo, created_at, updated_at`,
      [nome, email, telefone || null, cargo, permissoes || [], senhaHash],
    );
    res.json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === '23505') {
      const field = pgErr.constraint?.includes('email') ? 'email' : 'telefone';
      return void res.status(409).json({ success: false, error: `Já existe um colaborador com este ${field}` });
    }
    res.status(500).json({ success: false, error: 'Falha ao criar colaborador' });
  }
});

// PUT /colaboradores/:id
router.put('/colaboradores/:id', async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const data = req.body;
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (data.nome !== undefined) { fields.push(`nome = $${i++}`); values.push(data.nome); }
  if (data.email !== undefined) { fields.push(`email = $${i++}`); values.push(data.email || null); }
  if (data.telefone !== undefined) { fields.push(`telefone = $${i++}`); values.push(data.telefone || null); }
  if (data.cargo !== undefined) { fields.push(`cargo = $${i++}`); values.push(data.cargo); }
  if (data.permissoes !== undefined) { fields.push(`permissoes = $${i++}`); values.push(data.permissoes); }
  if (fields.length === 0) return void res.status(400).json({ success: false, error: 'Nenhum campo para atualizar' });
  fields.push('updated_at = NOW()');
  values.push(id);
  try {
    const { rows } = await pool.query(`UPDATE colaboradores SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, values);
    if (rows.length === 0) return void res.status(404).json({ success: false, error: 'Colaborador não encontrado' });
    res.json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === '23505') {
      const field = pgErr.constraint?.includes('email') ? 'email' : 'telefone';
      return void res.status(409).json({ success: false, error: `Já existe um colaborador com este ${field}` });
    }
    res.status(500).json({ success: false, error: 'Falha ao atualizar colaborador' });
  }
});

// POST /colaboradores/:id/toggle
router.post('/colaboradores/:id/toggle', async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  try {
    const { rows } = await pool.query(`UPDATE colaboradores SET ativo=NOT ativo, updated_at=NOW() WHERE id=$1 RETURNING *`, [id]);
    if (rows.length === 0) return void res.status(404).json({ success: false, error: 'Colaborador não encontrado' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Falha ao alterar status' });
  }
});

// POST /colaboradores/:id/senha
router.post('/colaboradores/:id/senha', async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const { novaSenha } = req.body;
  if (!novaSenha || novaSenha.length < 4) return void res.status(400).json({ success: false, error: 'A senha deve ter no mínimo 4 caracteres' });
  try {
    const hash = await bcrypt.hash(novaSenha, 10);
    const { rowCount } = await pool.query('UPDATE colaboradores SET senha_hash=$1, updated_at=NOW() WHERE id=$2', [hash, id]);
    if (rowCount === 0) return void res.status(404).json({ success: false, error: 'Colaborador não encontrado' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Falha ao redefinir senha' });
  }
});

// GET /colaboradores/cargos
router.get('/colaboradores/cargos', async (_req: Request, res: Response) => {
  try {
    const { rows } = await query('SELECT DISTINCT cargo FROM colaboradores ORDER BY cargo');
    res.json({ success: true, data: rows.map((r) => r.cargo) });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Falha ao carregar cargos' });
  }
});

export default router;
