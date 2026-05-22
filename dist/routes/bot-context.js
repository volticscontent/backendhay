"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const redis_1 = __importDefault(require("../lib/redis"));
const router = (0, express_1.Router)();
// POST /api/bot/context-update
// Frontend injects proactive context for the bot to pick up on the next message
router.post('/bot/context-update', async (req, res) => {
    const { userPhone, context } = req.body;
    if (!userPhone || !context || typeof context !== 'object') {
        return void res.status(400).json({ error: 'userPhone and context object are required' });
    }
    const key = `bot_context:${userPhone}`;
    await redis_1.default.set(key, JSON.stringify(context), 'EX', 86400);
    res.json({ status: 'updated', key });
});
// GET /api/bot/context/:userPhone  (debug/admin use)
router.get('/bot/context/:userPhone', async (req, res) => {
    const raw = await redis_1.default.get(`bot_context:${req.params.userPhone}`);
    if (!raw)
        return void res.status(404).json({ error: 'No context found' });
    res.json(JSON.parse(raw));
});
exports.default = router;
//# sourceMappingURL=bot-context.js.map