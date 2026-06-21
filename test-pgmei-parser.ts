/**
 * test-pgmei-parser.ts — Testa parseSerproData() com diferentes envelopes
 * Rodar: npx tsx test-pgmei-parser.ts
 */
import { parseSerproData } from './src/ai/agents/apolo/workflow-regularizacao';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function assert(label: string, actual: boolean | null, expected: boolean | null) {
    if (actual === expected) {
        console.log(`${GREEN}✅ PASS${RESET} ${label} → ${actual}`);
        passed++;
    } else {
        console.log(`${RED}❌ FAIL${RESET} ${label} → esperado ${expected}, recebeu ${actual}`);
        failed++;
    }
}

async function main() {
    console.log('=== Teste parseSerproData() — Detecção de débitos PGMEI ===\n');

    // 1. Envelope com guias em aberto (JSON estruturado)
    const env1 = {
        dados: JSON.stringify({
            situacaoContribuinte: 'DEVEDOR',
            guiasEmAberto: [{ ano: 2025, valor: 75.90 }]
        }),
        mensagens: []
    };
    const r1 = await parseSerproData(env1);
    assert('JSON com guiasEmAberto + DEVEDOR', r1.tem_debitos_detectado, true);

    // 2. Envelope sem débitos (JSON estruturado)
    const env2 = {
        dados: JSON.stringify({
            situacaoContribuinte: 'SEM_DEBITO'
        }),
        mensagens: []
    };
    const r2 = await parseSerproData(env2);
    assert('JSON com SEM_DEBITO', r2.tem_debitos_detectado, false);

    // 3. Array vazio + mensagem 25001 (sem débitos)
    const env3 = {
        dados: '[]',
        mensagens: [{ codigo: '25001', texto: 'Não há débitos para o período informado.' }]
    };
    const r3 = await parseSerproData(env3);
    assert('Array vazio + msg 25001 (sem débitos)', r3.tem_debitos_detectado, false);

    // 4. Array vazio sem mensagem (inconclusivo)
    const env4 = {
        dados: '[]',
        mensagens: []
    };
    const r4 = await parseSerproData(env4);
    assert('Array vazio + sem mensagem (inconclusivo)', r4.tem_debitos_detectado, null);

    // 5. Array com item ENVIADO A PFN
    const env5 = {
        dados: JSON.stringify([{ situacaoDebito: 'ENVIADO A PFN', competencia: '2025-01' }]),
        mensagens: []
    };
    const r5 = await parseSerproData(env5);
    assert('Array com item ENVIADO A PFN', r5.tem_debitos_detectado, true);

    // 6. JSON com campo periodoApuracao (novo formato Serpro)
    const env6 = {
        dados: JSON.stringify({
            periodoApuracao: '2025-01',
            valorPrincipal: 75.90,
            situacao: 'PENDENTE'
        }),
        mensagens: []
    };
    const r6 = await parseSerproData(env6);
    assert('JSON com periodoApuracao + valorPrincipal (novo formato)', r6.tem_debitos_detectado, true);

    // 7. JSON com situação VENCIDA
    const env7 = {
        dados: JSON.stringify({
            situacaoContribuinte: 'VENCIDO',
            competencias: [{ ref: '2025-03', valor: 80.00 }]
        }),
        mensagens: []
    };
    const r7 = await parseSerproData(env7);
    assert('JSON com VENCIDO + competencias', r7.tem_debitos_detectado, true);

    // 8. JSON com NADA CONSTA
    const env8 = {
        dados: JSON.stringify({
            situacaoContribuinte: 'NADA CONSTA'
        }),
        mensagens: []
    };
    const r8 = await parseSerproData(env8);
    assert('JSON com NADA CONSTA', r8.tem_debitos_detectado, false);

    // 9. Dados null (envelope sem dados)
    const env9 = {
        dados: null,
        mensagens: [{ codigo: '25001', texto: 'Não há débitos para este período' }]
    };
    const r9 = await parseSerproData(env9);
    assert('Dados null + msg sem débitos', r9.tem_debitos_detectado, false);

    // 10. JSON com campo EM DIA
    const env10 = {
        dados: JSON.stringify({
            situacaoContribuinte: 'EM DIA'
        }),
        mensagens: []
    };
    const r10 = await parseSerproData(env10);
    assert('JSON com EM DIA', r10.tem_debitos_detectado, false);

    console.log(`\n=== Resultado: ${passed} passaram, ${failed} falharam ===`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
});
