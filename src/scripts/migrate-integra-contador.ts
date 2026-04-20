import 'dotenv/config';
import pool from '../lib/db';
import { readFileSync } from 'fs';
import { join } from 'path';

async function migrate() {
    const sql = readFileSync(
        join(__dirname, '../../../src/lib/db/migrations/011_integra_contador.sql'),
        'utf8'
    );
    await pool.query(sql);
    console.log('Migration 011_integra_contador: OK');
    await pool.end();
}

migrate().catch((e) => { console.error(e); process.exit(1); });
