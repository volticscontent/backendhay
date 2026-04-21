import { Router, Request, Response } from 'express';
import redis from '../lib/redis';

const router = Router();

// POST /api/bot/context-update
// Frontend injects proactive context for the bot to pick up on the next message
router.post('/bot/context-update', async (req: Request, res: Response) => {
    const { userPhone, context } = req.body;
    if (!userPhone || !context || typeof context !== 'object') {
        return void res.status(400).json({ error: 'userPhone and context object are required' });
    }

    const key = `bot_context:${userPhone}`;
    await redis.set(key, JSON.stringify(context), 'EX', 86400);
    res.json({ status: 'updated', key });
});

// GET /api/bot/context/:userPhone  (debug/admin use)
router.get('/bot/context/:userPhone', async (req: Request, res: Response) => {
    const raw = await redis.get(`bot_context:${req.params.userPhone}`);
    if (!raw) return void res.status(404).json({ error: 'No context found' });
    res.json(JSON.parse(raw));
});

export default router;
