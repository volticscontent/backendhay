"use strict";
/**
 * Teste manual dos serviços PGFN/DIVIDA_ATIVA do Serpro.
 *
 * Uso:
 *   tsx --env-file=.env src/scripts/test-serpro-pgfn.ts [CNPJ1] [CNPJ2] ...
 *
 * Se nenhum CNPJ for passado, usa os dois CNPJs de teste padrão.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const serpro_1 = require("../lib/serpro");
const workflow_regularizacao_1 = require("../ai/agents/apolo/workflow-regularizacao");
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
// CNPJs de teste padrão — ajuste conforme necessário
const DEFAULT_CNPJS = [
    '45723564000190', // CNPJ de teste (Haylander mock)
    '23950473000155', // CNPJ real — bug falso negativo PGMEI/PGFN (2026-05-06)
];
const ANOS_TESTE = [2022, 2023, 2024, 2025];
function fmt(v) {
    if (v === true)
        return `${RED}${BOLD}COM_DEBITO${RESET}`;
    if (v === false)
        return `${GREEN}SEM_DEBITO${RESET}`;
    return `${YELLOW}INCONCLUSIVO${RESET}`;
}
async function testarServico(label, cnpj, servico, ano) {
    process.stdout.write(`  ${DIM}${label} ${ano}...${RESET} `);
    const start = Date.now();
    try {
        const raw = await (0, serpro_1.consultarServico)(servico, cnpj, { ano });
        const envelope = raw;
        const parsed = await (0, workflow_regularizacao_1.parseSerproData)(envelope);
        const ms = Date.now() - start;
        console.log(`${fmt(parsed.tem_debitos_detectado)} ` +
            `${DIM}[${ms}ms]${RESET}` +
            (parsed.tem_documento_binario ? ` ${CYAN}PDF${RESET}` : '') +
            (parsed.mensagens_serpro.length ? ` ${DIM}msg: ${parsed.mensagens_serpro[0]}${RESET}` : ''));
        if (parsed.texto_pdf) {
            console.log(`    ${DIM}PDF excerpt: ${parsed.texto_pdf.slice(0, 200).replace(/\n/g, ' ')}${RESET}`);
        }
        if (parsed.dados && Object.keys(parsed.dados).length) {
            const dadosStr = JSON.stringify(parsed.dados).slice(0, 300);
            console.log(`    ${DIM}dados: ${dadosStr}${RESET}`);
        }
        // Debug: mostra envelope bruto quando inconclusivo
        if (parsed.tem_debitos_detectado === null) {
            const raw2 = envelope;
            const dadosRaw = raw2.dados;
            const dadosPreview = typeof dadosRaw === 'string'
                ? dadosRaw.slice(0, 200)
                : JSON.stringify(dadosRaw).slice(0, 200);
            console.log(`    ${DIM}[raw.dados]: ${dadosPreview}${RESET}`);
            console.log(`    ${DIM}[raw.keys]: ${Object.keys(raw2).join(', ')}${RESET}`);
        }
    }
    catch (err) {
        const ms = Date.now() - start;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`${RED}ERRO${RESET} ${DIM}[${ms}ms] ${msg.slice(0, 120)}${RESET}`);
    }
}
async function testarCnpj(cnpj) {
    console.log(`\n${BOLD}${CYAN}CNPJ: ${cnpj}${RESET}`);
    console.log(`${'─'.repeat(60)}`);
    // PGFN_CONSULTAR (v2.4) — usado na Camada 1
    console.log(`${BOLD}PGFN_CONSULTAR (Camada 1 — v2.4)${RESET}`);
    for (const ano of ANOS_TESTE) {
        await testarServico('PGFN_CONSULTAR', cnpj, 'PGFN_CONSULTAR', String(ano));
    }
    // DIVIDA_ATIVA (v2.4) — usado na Camada 2
    console.log(`\n${BOLD}DIVIDA_ATIVA (Camada 2 — v2.4)${RESET}`);
    for (const ano of ANOS_TESTE) {
        await testarServico('DIVIDA_ATIVA', cnpj, 'DIVIDA_ATIVA', String(ano));
    }
}
async function main() {
    const cnpjs = process.argv.slice(2).length
        ? process.argv.slice(2).map(c => c.replace(/\D/g, ''))
        : DEFAULT_CNPJS;
    console.log(`${BOLD}Serpro PGFN/DIVIDA_ATIVA — Teste de Integração${RESET}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`CNPJs: ${cnpjs.join(', ')}`);
    console.log(`Anos:  ${ANOS_TESTE.join(', ')}`);
    for (const cnpj of cnpjs) {
        await testarCnpj(cnpj);
    }
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`${GREEN}Teste concluído.${RESET}\n`);
    process.exit(0);
}
main().catch(err => {
    console.error(`${RED}Erro fatal:${RESET}`, err);
    process.exit(1);
});
//# sourceMappingURL=test-serpro-pgfn.js.map