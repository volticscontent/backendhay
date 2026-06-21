import 'dotenv/config';
import { checkCnpjSerpro } from './src/ai/server-tools';
import { parseSerproData } from './src/ai/agents/apolo/workflow-regularizacao';
import { consultarDividaAtivaPorDevedor } from './src/lib/pgfn';

const ANOS_RETROATIVOS = 5;

async function testarCNPJ(cnpj: string, descricao: string) {
    console.log(`\n======================================================`);
    console.log(`TESTANDO CNPJ: ${cnpj} - ${descricao}`);
    console.log(`======================================================`);

    const currentYear = new Date().getFullYear();
    const anos = Array.from({ length: ANOS_RETROATIVOS + 1 }, (_, i) => currentYear - ANOS_RETROATIVOS + i);

    console.log(`\n1. Consultando PGMEI para os anos: ${anos.join(', ')}...`);
    try {
        const pgmeiRawAll = await Promise.allSettled(anos.map(ano => checkCnpjSerpro(cnpj, 'PGMEI', { ano: String(ano) })));
        
        for (let i = 0; i < anos.length; i++) {
            const ano = anos[i];
            const result = pgmeiRawAll[i];
            if (result.status === 'rejected') {
                console.log(`  - ${ano}: Erro na consulta (inconclusivo)`);
            } else {
                try {
                    const envelope = JSON.parse(result.value);
                    if (ano === 2021) console.log(`\n\n=== ENVELOPE BRUTO 2021 ===\n`, JSON.stringify(envelope, null, 2), `\n\n`);
                    const parsed = await parseSerproData(envelope);
                    console.log(`  - ${ano}: tem_debitos = ${parsed.tem_debitos_detectado}`);
                    if (parsed.tem_debitos_detectado) {
                        console.log(`    [!] Valores extraídos: ${parsed.resumo_valores || 'Nenhum'}`);
                        if (!parsed.resumo_valores) console.log(`    [!] DADOS ORIGINAIS:`, JSON.stringify(parsed.dados));
                        console.log(`    [!] MENSAGENS:`, JSON.stringify(parsed.mensagens_serpro));
                        console.log(`    [!] Resumo PDF extraído: ${parsed.texto_pdf ? 'Sim' : 'Não'}`);
                    }
                } catch (e) {
                    console.log(`  - ${ano}: Erro no parse (inconclusivo)`);
                }
            }
        }
    } catch (e) {
        console.error(`Erro ao consultar PGMEI:`, e);
    }

    console.log(`\n2. Consultando Dívida Ativa PGFN...`);
    try {
        const pgfn = await consultarDividaAtivaPorDevedor(cnpj);
        console.log(`  - tem_debitos_detectado = ${pgfn.tem_debitos_detectado}`);
        console.log(`  - Resumo PGFN: ${pgfn.resumo.resumo_texto}`);
        if (pgfn.tem_debitos_detectado) {
             console.log(`    [!] Inscrições:`, pgfn.resumo.inscricoes.map(i => `${i.situacaoDescricao} - ${i.valorTotalConsolidadoMoeda}`));
        }
    } catch (e) {
        console.error(`  - Erro PGFN:`, e instanceof Error ? e.message : e);
    }
}

async function main() {
    // CNPJ 1 (que dava erro na procuracao/pgfn)
    await testarCNPJ('52029434000118', 'LUCIMAR COSTA DE OLIVEIRA ARAGÃO (Sem dívida / Inconclusivo no bug antigo)');
    
    // CNPJ 2 (que tinha pendência mas PGMEI dava sem dívida)
    await testarCNPJ('19401379000170', 'MARLON FERREIRA DE ARAUJO (Com dívida)');

    process.exit(0);
}

main();
