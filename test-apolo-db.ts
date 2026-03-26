import { query } from './src/lib/db';
import { runApoloAgent } from './src/ai/agents/apolo';

async function main() {
    console.log("Inserindo mock lead no BD...");
    const phone = '556199999999';
    const cnpj = '14511139000104';
    
    // Inserir
    await query(`INSERT INTO leads (nome_completo, telefone, email) VALUES ('Apolo Tester', $1, 'teste@haylander.com') ON CONFLICT (telefone) DO NOTHING`, [phone]);
    const res = await query(`SELECT id FROM leads WHERE telefone = $1`, [phone]);
    const leadId = res.rows[0].id;
    
    await query(`INSERT INTO leads_empresarial (lead_id, cnpj) VALUES ($1, $2) ON CONFLICT (lead_id) DO UPDATE SET cnpj = EXCLUDED.cnpj`, [leadId, cnpj]);
    
    // Testar apolo
    console.log("Executando Apolo Agent (Fase de Validação Serpro post-eCAC)...");
    try {
        const response = await runApoloAgent('Já fiz tudo no e-CAC e confirmei a procuração. Pode validar no seu sistema agora?', {
            userId: 'mock',
            userPhone: phone,
            history: [
                { role: 'assistant', content: 'Vou te mandar agora o link oficial e um vídeo tutorial que preparamos para te guiar passo a passo. Dá uma olhadinha 👇' },
                { role: 'user', content: 'Ok, vou fazer.' }
            ],
            userName: 'Apolo Tester'
        });
        console.log("==== RESPOSTA APOLO ====");
        console.log(response);
    } catch (e) {
        console.error(e);
    }
    
    // Limpar
    await query(`DELETE FROM leads_empresarial WHERE lead_id = $1`, [leadId]);
    await query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    console.log("Mock lead removido.");
    process.exit(0);
}
main();
