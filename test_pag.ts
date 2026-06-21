import * as dotenv from 'dotenv';
dotenv.config();
import { evolutionFindChats, evolutionFindMessages } from './src/lib/evolution';

async function run() {
    console.log("Iniciando teste de paginação...");
    const chats = await evolutionFindChats();
    if (!chats || chats.length === 0) {
        console.log("Nenhum chat encontrado.");
        return;
    }
    
    // Pegar o primeiro chat válido
    const chat = chats[0] as any;
    const jid = chat.id || chat.remoteJid;
    console.log(`Chat selecionado: ${jid}`);
    
    console.log("\nBuscando Página 1 (limit 2)...");
    const p1 = await evolutionFindMessages(jid, 2, 1);
    const ids1 = p1?.messages?.records?.map((r: any) => r.key?.id);
    console.log('P1 IDs:', ids1);
    
    console.log("\nBuscando Página 2 (limit 2)...");
    const p2 = await evolutionFindMessages(jid, 2, 2);
    const ids2 = p2?.messages?.records?.map((r: any) => r.key?.id);
    console.log('P2 IDs:', ids2);

    if (ids1 && ids2 && ids1[0] !== ids2[0]) {
        console.log("\n✅ A paginação FUNCIONOU! Os IDs das mensagens mudaram de uma página para outra.");
    } else if (ids1 && ids2 && ids1[0] === ids2[0]) {
        console.log("\n❌ A paginação FALHOU. A página 2 retornou as mesmas mensagens da página 1.");
    } else {
        console.log("\nNão foi possível verificar, pois não há mensagens suficientes.");
    }
}

run().catch(console.error);
