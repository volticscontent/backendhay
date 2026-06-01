require('dotenv').config();
import { getRegularizacaoTools } from './src/ai/agents/apolo/workflow-regularizacao';

async function test() {
  console.log('Testing getRegularizacaoTools...');
  const context = { userPhone: '553182354127', userId: '553182354127@s.whatsapp.net', userName: 'Sales', history: [], outOfHours: false };
  const tools = getRegularizacaoTools(context);
  const pgmeiTool = tools.find(t => t.name === 'consultar_pgmei_serpro');
  console.log('Found tool:', pgmeiTool ? pgmeiTool.name : 'NOT FOUND');
  if (pgmeiTool) {
    console.log('Calling consultar_pgmei_serpro...');
    const result = await pgmeiTool.function({});
    console.log('Result:', result);
  }
}

test();
