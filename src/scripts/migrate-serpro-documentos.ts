import pool from '../lib/db';

async function migrate() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS serpro_documentos (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            cnpj        VARCHAR(14)  NOT NULL,
            tipo_servico VARCHAR(50) NOT NULL,
            protocolo   VARCHAR(100),
            r2_key      TEXT         NOT NULL,
            r2_url      TEXT         NOT NULL,
            tamanho_bytes INTEGER,
            valido_ate  TIMESTAMPTZ,
            gerado_por  VARCHAR(20)  NOT NULL DEFAULT 'admin',
            lead_id     INTEGER      REFERENCES leads(id) ON DELETE SET NULL,
            metadata    JSONB,
            deletado_em TIMESTAMPTZ,
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_serpro_docs_cnpj   ON serpro_documentos(cnpj);
        CREATE INDEX IF NOT EXISTS idx_serpro_docs_tipo   ON serpro_documentos(tipo_servico);
        CREATE INDEX IF NOT EXISTS idx_serpro_docs_valido ON serpro_documentos(valido_ate) WHERE deletado_em IS NULL;
    `);
    console.log('Migration serpro_documentos: OK');
    await pool.end();
}

migrate().catch((e) => { console.error(e); process.exit(1); });
