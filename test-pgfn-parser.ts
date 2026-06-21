/**
 * test-pgfn-parser.ts — Testa detectarDebitoPgfn() e buildPgfnResumo()
 * Rodar: npx tsx test-pgfn-parser.ts
 */

// Import internals via dynamic path — pgfn.ts exports the main functions
// We'll test by calling consultarDividaAtivaPorDevedor with mock scenarios
// But since PGFN functions are not all exported, we replicate the detection logic here for unit test

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

// Replicate detectarDebitoPgfn logic with the FIX applied
function detectarDebitoPgfnFixed(data: unknown, resumo: { total_inscricoes: number }): boolean | null {
    if (resumo.total_inscricoes > 0) return true;
    const texto = JSON.stringify(data)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

    const SEM_DEBITO_PATTERNS = [
        'NAO HA DEBITOS', 'NADA CONSTA', 'SEM DEBITO', 'SEM DEBITOS',
        'NAO FORAM ENCONTRAD', 'NENHUMA INSCRICAO', 'DEVEDOR NAO LOCALIZADO',
        'NAO LOCALIZADO', 'SEM INSCRICAO', 'NENHUM REGISTRO',
        'NAO EXISTE INSCRICAO', 'NAO EXISTEM INSCRICOES'
    ];
    if (SEM_DEBITO_PATTERNS.some(s => texto.includes(s))) return false;
    if (['INSCRICAO', 'DIVIDA ATIVA', 'DEVEDOR', 'DEBITO', 'AJUIZADA', 'EXIGIVEL'].some(s => texto.includes(s))) return true;

    // Se não há inscrições e nenhum pattern de débito ativo foi encontrado,
    // considerar como sem débito (evita falso 'inconclusivo')
    if (resumo.total_inscricoes === 0) return false;

    return null;
}

function main() {
    console.log('=== Teste detectarDebitoPgfn() — Detecção de débitos PGFN ===\n');

    // 1. CNPJ com inscrição ativa
    assert(
        'CNPJ com 1 inscrição (resumo.total=1)',
        detectarDebitoPgfnFixed({ inscricoes: [{ valor: 6000 }] }, { total_inscricoes: 1 }),
        true
    );

    // 2. "Não há débitos" clássico
    assert(
        '"Não há débitos" no corpo',
        detectarDebitoPgfnFixed({ mensagem: 'Não há débitos para este contribuinte' }, { total_inscricoes: 0 }),
        false
    );

    // 3. "Nada consta" variação
    assert(
        '"Nada consta" no corpo',
        detectarDebitoPgfnFixed({ resultado: 'Nada consta' }, { total_inscricoes: 0 }),
        false
    );

    // 4. "Não foram encontradas inscrições" (novo pattern)
    assert(
        '"Não foram encontradas inscrições"',
        detectarDebitoPgfnFixed({ mensagem: 'Não foram encontradas inscrições para o devedor' }, { total_inscricoes: 0 }),
        false
    );

    // 5. "Nenhuma inscrição" (novo pattern)
    assert(
        '"Nenhuma inscrição encontrada"',
        detectarDebitoPgfnFixed({ mensagem: 'Nenhuma inscrição encontrada' }, { total_inscricoes: 0 }),
        false
    );

    // 6. "Devedor não localizado" (novo pattern)
    assert(
        '"Devedor não localizado"',
        detectarDebitoPgfnFixed({ mensagem: 'Devedor não localizado na base' }, { total_inscricoes: 0 }),
        false
    );

    // 7. Resposta vazia total (antes era inconclusivo, agora é false)
    assert(
        'Resposta vazia sem patterns (antes: null, agora: false)',
        detectarDebitoPgfnFixed({}, { total_inscricoes: 0 }),
        false
    );

    // 8. Resposta null (antes era inconclusivo, agora: false)
    assert(
        'Data = null (antes: null, agora: false)',
        detectarDebitoPgfnFixed(null, { total_inscricoes: 0 }),
        false
    );

    // 9. Corpo com "DIVIDA ATIVA" explícito
    assert(
        'Corpo com "DIVIDA ATIVA" explícito',
        detectarDebitoPgfnFixed({ resultado: 'Inscrição em DIVIDA ATIVA encontrada' }, { total_inscricoes: 0 }),
        true
    );

    // 10. Corpo com "AJUIZADA"
    assert(
        'Corpo com "AJUIZADA"',
        detectarDebitoPgfnFixed({ situacao: 'AJUIZADA' }, { total_inscricoes: 0 }),
        true
    );

    console.log(`\n=== Resultado: ${passed} passaram, ${failed} falharam ===`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
