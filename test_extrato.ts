import { checkCnpjSerpro } from './src/ai/server-tools';
import { parseSerproData } from './src/ai/agents/apolo/workflow-regularizacao';
import { serproLogger } from './src/lib/logger';
import dotenv from 'dotenv';
dotenv.config();

// mock redis
jest = require('jest');
jest.mock('./src/lib/redis', () => ({
  redis: { get: async () => null, set: async () => 'OK', quit: async () => 'OK' }
}));

async function main() {
  serproLogger.level = 'debug';
  const res = await checkCnpjSerpro('23950473000155', 'PGMEI_EXTRATO', { ano: '2024' });
  const parsed = await parseSerproData(JSON.parse(res));
  console.log(parsed.tem_debitos_detectado, parsed.texto_pdf?.substring(0, 200));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });