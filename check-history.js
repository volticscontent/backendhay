require('dotenv').config();
const { getChatHistory } = require('./dist/lib/chat-history');

async function checkHistory() {
  const history = await getChatHistory('553182354127');
  console.log('=== HISTÓRICO COMPLETO ===');
  history.forEach((msg, i) => {
    console.log(`${i+1}. [${msg.role.toUpperCase()}]`);
    console.log(msg.content);
    console.log('------------------------------');
  });
}

checkHistory().catch(console.error);
