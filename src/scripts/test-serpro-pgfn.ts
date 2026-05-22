import { consultarDividaAtivaPorDevedor } from '../lib/pgfn';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

const DEFAULT_CNPJS = [
    '23950473000155',
    '14511139000104',
];

function fmt(value: boolean | null): string {
    if (value === true) return `${RED}${BOLD}COM_DEBITO${RESET}`;
    if (value === false) return `${GREEN}SEM_DEBITO${RESET}`;
    return `${YELLOW}INCONCLUSIVO${RESET}`;
}

async function testarCnpj(cnpj: string): Promise<void> {
    const cleanCnpj = cnpj.replace(/\D/g, '');
    console.log(`\n${BOLD}${CYAN}PGFN API avulsa — CNPJ: ${cleanCnpj}${RESET}`);
    console.log(`${'─'.repeat(70)}`);
    const start = Date.now();

    try {
        const result = await consultarDividaAtivaPorDevedor(cleanCnpj);
        const ms = Date.now() - start;
        console.log(`Resultado: ${fmt(result.tem_debitos_detectado)} ${DIM}[${ms}ms]${RESET}`);
        console.log(`Origem: ${result.origem}`);
        console.log(`Consulta: ${result.consulta}`);
        console.log(`Resumo: ${result.resumo.resumo_texto}`);
        console.log(`Total inscrições: ${result.resumo.total_inscricoes}`);
        console.log(`Valor total: ${result.resumo.valor_total_consolidado_moeda}`);
        console.log(`Ativas: ${result.resumo.total_ativas} | Ajuizadas: ${result.resumo.total_ajuizadas} | Negociadas: ${result.resumo.total_negociadas}`);

        for (const inscricao of result.resumo.inscricoes) {
            console.log(`\n  Inscrição: ${inscricao.numeroInscricao || 'não informada'}`);
            console.log(`  Valor: ${inscricao.valorTotalConsolidadoMoeda || 'não informado'}`);
            console.log(`  Situação: ${inscricao.situacaoDescricao || 'não informada'}`);
            console.log(`  Regularidade: ${inscricao.tipoRegularidade || 'não informada'}`);
            console.log(`  Receita: ${inscricao.receitaPrincipal || 'não informada'}`);
            console.log(`  Data inscrição: ${inscricao.dataInscricao || 'não informada'}`);
        }

        if (result.mensagens_pgfn.length) console.log(`\nMensagem: ${result.mensagens_pgfn[0]}`);
    } catch (error) {
        const ms = Date.now() - start;
        const message = error instanceof Error ? error.message : String(error);
        console.log(`${RED}ERRO${RESET} ${DIM}[${ms}ms]${RESET} ${message.slice(0, 1000)}`);
    }
}

async function main(): Promise<void> {
    const cnpjs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CNPJS;
    console.log(`${BOLD}Teste PGFN — API Consulta Dívida Ativa avulsa${RESET}`);
    console.log(`CNPJs: ${cnpjs.map(c => c.replace(/\D/g, '')).join(', ')}`);

    for (const cnpj of cnpjs) await testarCnpj(cnpj);

    console.log(`\n${GREEN}Teste concluído.${RESET}`);
}

main().catch(error => {
    console.error(`${RED}Erro fatal:${RESET}`, error);
    process.exit(1);
});
