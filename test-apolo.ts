import { runApoloAgent } from './src/ai/agents/apolo';
import { AgentContext, AgentMessage } from './src/ai/types';
import dotenv from 'dotenv';
dotenv.config();

// Mock context
const mockContext: AgentContext = {
    userId: 'mock-id',
    userPhone: '556199999999',  // Assuming this doesn't exist or doesn't have a valid procuracao in db
    userName: 'Tester',
    history: []
};

const mockMessage: AgentMessage = 'Fiz a procuração lá no ECAC, verifica pra mim pfv.';

async function testAgent() {
    try {
        console.log("Iniciando simulação do Apolo...");
        const response = await runApoloAgent(mockMessage, mockContext);
        console.log("--- Resposta do Apolo ---");
        console.log(response);
    } catch (e) {
        console.error("Erro no teste:", e);
    }
}

testAgent();
