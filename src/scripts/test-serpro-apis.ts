/**
 * Teste exaustivo de todos os serviços Serpro disponíveis.
 *
 * Uso:
 *   cd bot-backend
 *   npx tsx src/scripts/test-serpro-apis.ts [CNPJ] [CPF]
 *
 * CNPJ: CNPJ do MEI a testar (14 dígitos, sem formatação)
 * CPF:  CPF do empresário (11 dígitos) — obrigatório para SITFIS/CND
 *
 * O script chama o endpoint /api/serpro do bot-backend local (porta 3001).
 * O backend deve estar rodando com `npm run dev`.
 */

const BASE = 'http://127.0.0.1:3001';
const CNPJ = process.argv[2]?.replace(/\D/g, '') || '45723564000190';
const CPF  = process.argv[3]?.replace(/\D/g, '') || '';

const ANO_ATUAL   = String(new Date().getFullYear());
const ANO_ANTERIOR = String(new Date().getFullYear() - 1);
const MES_ATUAL   = String(new Date().getMonth() + 1).padStart(2, '0');

// Delay para não saturar o Serpro
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Resultado = {
  service: string;
  status: '✅ OK' | '❌ ERRO' | '⚠️  SKIP' | '⚠️  AVISO';
  ms: number;
  info: string;
};

// ─── Chamada ao backend ────────────────────────────────────────────────────────

async function call(
  service: string,
  extra: Record<string, string | undefined> = {},
): Promise<{ ok: boolean; status: number; body: unknown; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/serpro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cnpj: CNPJ, service, ...extra }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body, ms: Date.now() - t0 };
}

function resumo(body: unknown): string {
  if (!body || typeof body !== 'object') return String(body).slice(0, 120);
  const b = body as Record<string, unknown>;
  // CCMEI/SIMEI
  if (b.nomeEmpresarial) return `nomeEmpresarial: ${b.nomeEmpresarial}`;
  // PGMEI/DIVIDA_ATIVA
  if (b.situacaoContribuinte) return `situacaoContribuinte: ${b.situacaoContribuinte}`;
  if (b.primary && typeof b.primary === 'object') return resumo(b.primary);
  // Mensagens de erro do Serpro
  if (Array.isArray(b.mensagens) && b.mensagens.length)
    return b.mensagens.map((m: { codigo?: string; texto?: string }) => `[${m.codigo}] ${m.texto}`).join(' | ').slice(0, 160);
  // dados como JSON string
  if (b.dados && typeof b.dados === 'string') {
    try { return resumo(JSON.parse(b.dados)); } catch { return b.dados.slice(0, 120); }
  }
  // Fallback: primeiras chaves
  const keys = Object.keys(b).slice(0, 4);
  return keys.map(k => `${k}: ${JSON.stringify(b[k])?.slice(0, 40)}`).join(' | ');
}

// ─── Testes individuais ────────────────────────────────────────────────────────

async function testar(
  service: string,
  extra: Record<string, string | undefined> = {},
  skipSe?: string,
): Promise<Resultado> {
  if (skipSe) {
    return { service, status: '⚠️  SKIP', ms: 0, info: skipSe };
  }

  await delay(800); // respeita rate-limit do Serpro
  try {
    const { ok, body, ms } = await call(service, extra);
    if (ok) {
      return { service, status: '✅ OK', ms, info: resumo(body) };
    }
    const b = body as Record<string, unknown>;
    const errMsg = String(b.error || b.message || JSON.stringify(b)).slice(0, 200);
    // Alguns erros esperados (sem dados no período, sem procuração, etc.) — aviso, não falha
    const AVISOS = [
      'não possui', 'não encontrado', 'sem dados', 'nenhum', 'não há',
      'PGMEI-BSN', 'CCMEI-BSN', 'SITFIS-BSN', 'não habilitado',
    ];
    if (AVISOS.some(a => errMsg.toLowerCase().includes(a.toLowerCase()))) {
      return { service, status: '⚠️  AVISO', ms, info: errMsg };
    }
    return { service, status: '❌ ERRO', ms, info: errMsg };
  } catch (e: unknown) {
    return { service, status: '❌ ERRO', ms: 0, info: String(e) };
  }
}

// ─── Runner principal ─────────────────────────────────────────────────────────

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' SERPRO — Teste Exaustivo de Serviços');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(` CNPJ : ${CNPJ}`);
  console.log(` CPF  : ${CPF || '(não fornecido — SITFIS/CND serão pulados)'}`);
  console.log(` Ano  : ${ANO_ATUAL}  |  Mês : ${MES_ATUAL}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  const resultados: Resultado[] = [];

  // ── 1. Dados cadastrais ─────────────────────────────────────────────────────
  resultados.push(await testar('CCMEI_DADOS'));
  resultados.push(await testar('SIMEI'));
  resultados.push(await testar('PROCURACAO'));

  // ── 2. PGMEI / DAS ──────────────────────────────────────────────────────────
  resultados.push(await testar('PGMEI', { ano: ANO_ATUAL }));
  resultados.push(await testar('PGMEI_EXTRATO', { ano: ANO_ATUAL, mes: MES_ATUAL }));
  resultados.push(await testar('PGMEI_BOLETO',  { ano: ANO_ATUAL, mes: MES_ATUAL }));
  resultados.push(await testar('PGMEI_ATU_BENEFICIO', { ano: ANO_ATUAL }));

  // ── 3. Situação Fiscal (SITFIS) — requer CPF ────────────────────────────────
  let sitfisProtocolo: string | undefined;

  if (CPF) {
    const solRes = await testar('SIT_FISCAL_SOLICITAR', { cpf: CPF });
    resultados.push(solRes);

    // Extrai protocolo da resposta para usar no RELATORIO e CND
    if (solRes.status === '✅ OK') {
      try {
        const raw = await call('SIT_FISCAL_SOLICITAR', { cpf: CPF });
        const b = raw.body as Record<string, unknown>;
        const dados = typeof b.dados === 'string' ? JSON.parse(b.dados) : b.dados;
        sitfisProtocolo = String(dados?.protocoloRelatorio || dados?.protocolo || '').trim() || undefined;
      } catch { /* mantém undefined */ }
    }

    resultados.push(await testar(
      'SIT_FISCAL_RELATORIO',
      { cpf: CPF, protocoloRelatorio: sitfisProtocolo },
      sitfisProtocolo ? undefined : 'Protocolo SITFIS não obtido no passo anterior',
    ));

    resultados.push(await testar(
      'CND',
      { cpf: CPF, protocoloRelatorio: sitfisProtocolo },
      sitfisProtocolo ? undefined : 'Protocolo SITFIS não obtido — CND depende do SITFIS',
    ));
  } else {
    const skip = 'CPF do empresário não fornecido (passe como 2º argumento)';
    resultados.push({ service: 'SIT_FISCAL_SOLICITAR', status: '⚠️  SKIP', ms: 0, info: skip });
    resultados.push({ service: 'SIT_FISCAL_RELATORIO', status: '⚠️  SKIP', ms: 0, info: skip });
    resultados.push({ service: 'CND',                  status: '⚠️  SKIP', ms: 0, info: skip });
  }

  // ── 4. Dívida Ativa / PGFN ──────────────────────────────────────────────────
  resultados.push(await testar('DIVIDA_ATIVA',   { ano: ANO_ATUAL }));
  resultados.push(await testar('PGFN_CONSULTAR', { ano: ANO_ATUAL }));

  // ── 5. Parcelamentos ────────────────────────────────────────────────────────
  resultados.push(await testar('PARCELAMENTO_MEI_CONSULTAR'));
  resultados.push(await testar('PARCELAMENTO_SN_CONSULTAR'));
  resultados.push(await testar('PARCELAMENTO_MEI_EMITIR', { ano: ANO_ATUAL, mes: MES_ATUAL }));
  resultados.push(await testar('PARCELAMENTO_SN_EMITIR',  { ano: ANO_ATUAL, mes: MES_ATUAL }));

  // ── 6. Declarações ──────────────────────────────────────────────────────────
  resultados.push(await testar('DASN_SIMEI', { ano: ANO_ANTERIOR }));
  resultados.push(await testar('PGDASD',
    {},
    'Requer numeroDas de uma consulta prévia — rode manualmente no painel após PGMEI',
  ));
  resultados.push(await testar('DCTFWEB', { ano: ANO_ATUAL, categoria: 'GERAL_MENSAL' }));

  // ── 7. Outros ───────────────────────────────────────────────────────────────
  resultados.push(await testar('CAIXA_POSTAL'));
  resultados.push(await testar('PROCESSOS'));
  resultados.push(await testar('PAGAMENTO'));

  // ─── Relatório final ─────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' RESULTADOS');
  console.log('══════════════════════════════════════════════════════════════\n');

  const colSvc  = 28;
  const colStat = 12;

  for (const r of resultados) {
    const svc  = r.service.padEnd(colSvc);
    const stat = r.status.padEnd(colStat);
    const ms   = r.ms ? `${r.ms}ms`.padStart(6) : '      ';
    console.log(`${svc} ${stat} ${ms}  ${r.info}`);
  }

  const ok    = resultados.filter(r => r.status === '✅ OK').length;
  const err   = resultados.filter(r => r.status === '❌ ERRO').length;
  const warn  = resultados.filter(r => r.status === '⚠️  AVISO').length;
  const skip  = resultados.filter(r => r.status === '⚠️  SKIP').length;
  const total = resultados.length;

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(` Total: ${total}  ✅ ${ok}  ❌ ${err}  ⚠️  avisos: ${warn}  ⏭  skip: ${skip}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  if (err > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
