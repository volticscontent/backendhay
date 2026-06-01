require('dotenv').config();
import { runApoloAgent } from './src/ai/agents/apolo/index';
import { getChatHistory } from './src/lib/chat-history';

async function test() {
    console.log('=== Starting Test Full Flow ===');
    const userPhone = '553182354127';
    const history = await getChatHistory(userPhone);
    console.log('Got history, messages length:', history.length);
    const context = {
        userId: '553182354127@s.whatsapp.net',
        userName: 'Sales',
        userPhone,
        history,
        outOfHours: false,
    };
    const userMessage = 'Então consulte meu cnpj';
    console.log('Calling runApoloAgent with message:', userMessage);

    try {
        const response = await runApoloAgent(userMessage, context);
        console.log('=== Response from Apolo ===');
        console.log(response);
    } catch (err) {
        console.error('=== ERROR ===');
        console.error(err);
        if (err instanceof Error && err.stack) {
            console.error(err.stack);
        }
    }
}

test();
