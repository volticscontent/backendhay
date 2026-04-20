"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../lib/db");
const router = (0, express_1.Router)();
// GET /settings
router.get('/settings', async (_req, res) => {
    try {
        const { rows } = await (0, db_1.query)(`SELECT DISTINCT ON (key) * FROM system_settings ORDER BY key, (value IS NOT NULL AND value <> '') DESC, updated_at DESC`);
        res.json({ success: true, data: rows.sort((a, b) => String(a.label).localeCompare(String(b.label))) });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch settings' });
    }
});
// GET /settings/:key
router.get('/settings/:key', async (req, res) => {
    try {
        const { rows } = await (0, db_1.query)('SELECT value FROM system_settings WHERE key = $1', [req.params.key]);
        res.json({ success: true, value: rows.length > 0 ? rows[0].value : null });
    }
    catch (err) {
        res.status(500).json({ success: false, error: `Failed to fetch setting` });
    }
});
// POST /settings
router.post('/settings', async (req, res) => {
    const { key, label, type, value } = req.body;
    if (!key || !label || !type)
        return void res.status(400).json({ success: false, error: 'key, label e type são obrigatórios' });
    try {
        await (0, db_1.query)(`INSERT INTO system_settings (key, label, type, value, updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (key) DO NOTHING`, [key, label, type, value || '']);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to create setting' });
    }
});
// PUT /settings/:key
router.put('/settings/:key', async (req, res) => {
    const { value } = req.body;
    try {
        await (0, db_1.query)('UPDATE system_settings SET value=$1, updated_at=NOW() WHERE key=$2', [value, req.params.key]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update setting' });
    }
});
// PUT /settings/:key/bots
router.put('/settings/:key/bots', async (req, res) => {
    const { bots } = req.body;
    try {
        await (0, db_1.query)('UPDATE system_settings SET allowed_bots=$1, updated_at=NOW() WHERE key=$2', [bots, req.params.key]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update setting bots' });
    }
});
// DELETE /settings/:key
router.delete('/settings/:key', async (req, res) => {
    try {
        await (0, db_1.query)('DELETE FROM system_settings WHERE key = $1', [req.params.key]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete setting' });
    }
});
exports.default = router;
//# sourceMappingURL=settings.js.map