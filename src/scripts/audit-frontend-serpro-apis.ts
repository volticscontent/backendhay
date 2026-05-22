import fs from 'node:fs';
import path from 'node:path';
import { consultarServico } from '../lib/serpro';
import { consultarDividaAtivaPorDevedor } from '../lib/pgfn';

const CNPJS = process.argv.slice(2).map(v => v.replace(/\D/g, '')).filter(Boolean);
const TEST_CNPJS = CNPJS.length >= 3 ? CNPJS.slice(0, 3) : ['23950473000155', '14511139000104', '45723564000190'];
const ANO_ATUAL = String(new Date().getFullYear());
const ANO_ANTERIOR = String(new Date().getFullYear() - 1);
const MES_ATUAL = String(new Date().getMonth() + 1).padStart(2, '0');
const OUT_DIR = path.resolve(process.cwd(), '..', 'knowledge-base', 'raw', 'docs');
const OUT_FILE = path.join(OUT_DIR, `audit-serpro-frontend-apis-${new Date().toISOString().slice(0, 10)}.md`);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type ServiceTest = {
  service: string;
  label: string;
  group: string;
  kind: 'integra' | 'pgfn_api';
  options?: Record<string, string | undefined>;
  skip?: string;
};

type Result = {
  cnpj: string;
  service: string;
  label: string;
  group: string;
  status: 'OK' | 'AVISO' | 'ERRO' | 'SKIP';
  ms: number;
  summary: string;
};

const SERVICES: ServiceTest[] = [
  { group: 'Dados Cadastrais & Enquadramento', service: 'CCMEI_DADOS', label: 'CCMEI Dados', kind: 'integra' },
  { group: 'Dados Cadastrais & Enquadramento', service: 'SIMEI', label: 'SIMEI', kind: 'integra' },
  { group: 'Dados Cadastrais & Enquadramento', service: 'PROCURACAO', label: 'Procuração', kind: 'integra' },
  { group: 'Guias e Débitos (PGMEI)', service: 'PGMEI', label: 'PGMEI Dívidas', kind: 'integra', options: { ano: ANO_ATUAL } },
  { group: 'Guias e Débitos (PGMEI)', service: 'PGMEI_EXTRATO', label: 'PGMEI Extrato PDF', kind: 'integra', options: { ano: ANO_ATUAL, mes: MES_ATUAL } },
  { group: 'Guias e Débitos (PGMEI)', service: 'PGMEI_BOLETO', label: 'PGMEI Boleto', kind: 'integra', options: { ano: ANO_ATUAL, mes: MES_ATUAL } },
  { group: 'Guias e Débitos (PGMEI)', service: 'PGMEI_ATU_BENEFICIO', label: 'PGMEI Atualização Benefício', kind: 'integra', options: { ano: ANO_ATUAL } },
  { group: 'Situação Fiscal & Certidões', service: 'SIT_FISCAL_SOLICITAR', label: 'SITFIS Solicitar', kind: 'integra', skip: 'Requer CPF do empresário; frontend tem campo opcional, mas teste em lote por CNPJ não deve inventar CPF.' },
  { group: 'Situação Fiscal & Certidões', service: 'SIT_FISCAL_RELATORIO', label: 'SITFIS Relatório', kind: 'integra', skip: 'Requer protocolo de solicitação SITFIS válido.' },
  { group: 'Situação Fiscal & Certidões', service: 'CND', label: 'CND', kind: 'integra', skip: 'Depende de CPF/protocolo SITFIS ou fluxo específico.' },
  { group: 'Dívida Ativa (PGFN)', service: 'PGFN_API', label: 'PGFN API Avulsa', kind: 'pgfn_api' },
  { group: 'Dívida Ativa (PGFN)', service: 'DIVIDA_ATIVA', label: 'Dívida Ativa legado Integra', kind: 'integra', options: { ano: ANO_ATUAL } },
  { group: 'Dívida Ativa (PGFN)', service: 'PGFN_CONSULTAR', label: 'PGFN legado Integra', kind: 'integra', options: { ano: ANO_ATUAL } },
  { group: 'Parcelamentos', service: 'PARCELAMENTO_MEI_CONSULTAR', label: 'Parcelamento MEI Consultar', kind: 'integra' },
  { group: 'Parcelamentos', service: 'PARCELAMENTO_SN_CONSULTAR', label: 'Parcelamento SN Consultar', kind: 'integra' },
  { group: 'Parcelamentos', service: 'PARCELAMENTO_MEI_EMITIR', label: 'Parcelamento MEI Emitir', kind: 'integra', options: { ano: ANO_ATUAL, mes: MES_ATUAL } },
  { group: 'Parcelamentos', service: 'PARCELAMENTO_SN_EMITIR', label: 'Parcelamento SN Emitir', kind: 'integra', options: { ano: ANO_ATUAL, mes: MES_ATUAL } },
  { group: 'Declarações', service: 'DASN_SIMEI', label: 'DASN SIMEI', kind: 'integra', options: { ano: ANO_ANTERIOR } },
  { group: 'Declarações', service: 'PGDASD', label: 'PGDASD', kind: 'integra', skip: 'Requer número DAS/recibo específico; frontend deixa manual.' },
  { group: 'Declarações', service: 'DCTFWEB', label: 'DCTFWeb', kind: 'integra', options: { ano: ANO_ATUAL, categoria: 'GERAL_MENSAL' } },
  { group: 'Mensagens e Processos', service: 'CAIXA_POSTAL', label: 'Caixa Postal', kind: 'integra' },
  { group: 'Mensagens e Processos', service: 'PROCESSOS', label: 'Processos', kind: 'integra' },
  { group: 'Mensagens e Processos', service: 'PAGAMENTO', label: 'Pagamento', kind: 'integra' },
];

function summarize(body: unknown): string {
  if (!body || typeof body !== 'object') return String(body).slice(0, 180);
  const b = body as Record<string, unknown>;
  if (b.status === 'error') return String(b.message || b.error || 'erro').slice(0, 220);
  if (b.resumo && typeof b.resumo === 'object') {
    const r = b.resumo as Record<string, unknown>;
    return String(r.resumo_texto || `inscrições=${r.total_inscricoes}; valor=${r.valor_total_consolidado_moeda}`).slice(0, 220);
  }
  if (b.primary && typeof b.primary === 'object') return summarize(b.primary);
  if (Array.isArray(b.mensagens) && b.mensagens.length) {
    return b.mensagens.map((m: { codigo?: string; texto?: string }) => `[${m.codigo || ''}] ${m.texto || ''}`).join(' | ').slice(0, 220);
  }
  if (typeof b.dados === 'string' && b.dados) {
    try { return summarize(JSON.parse(b.dados)); } catch { return b.dados.slice(0, 220); }
  }
  if (b.dados && typeof b.dados === 'object') return summarize(b.dados);
  const keys = Object.keys(b).slice(0, 5);
  return keys.map(k => `${k}=${JSON.stringify(b[k])?.slice(0, 60)}`).join('; ').slice(0, 220);
}

function classify(summary: string, failed: boolean): Result['status'] {
  if (!failed) return 'OK';
  const s = summary.toLowerCase();
  const warnings = ['não possui', 'nao possui', 'não encontrado', 'nao encontrado', 'sem dados', 'não há', 'nao ha', 'ausente', 'não habilitado', 'não existe', 'nao existe'];
  return warnings.some(w => s.includes(w)) ? 'AVISO' : 'ERRO';
}

async function runService(cnpj: string, test: ServiceTest): Promise<Result> {
  if (test.skip) return { cnpj, service: test.service, label: test.label, group: test.group, status: 'SKIP', ms: 0, summary: test.skip };
  const started = Date.now();
  await delay(700);
  try {
    const result = test.kind === 'pgfn_api'
      ? await consultarDividaAtivaPorDevedor(cnpj)
      : await consultarServico(test.service as never, cnpj, test.options || {});
    return { cnpj, service: test.service, label: test.label, group: test.group, status: 'OK', ms: Date.now() - started, summary: summarize(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { cnpj, service: test.service, label: test.label, group: test.group, status: classify(message, true), ms: Date.now() - started, summary: message.slice(0, 260) };
  }
}

function icon(status: Result['status']): string {
  return status === 'OK' ? '✅' : status === 'AVISO' ? '⚠️' : status === 'SKIP' ? '⏭️' : '❌';
}

function mdTable(results: Result[]): string {
  return [
    '| Grupo | Serviço | Status | Tempo | Resumo |',
    '|---|---|---:|---:|---|',
    ...results.map(r => `| ${r.group} | ${r.service} | ${icon(r.status)} ${r.status} | ${r.ms ? `${r.ms}ms` : '-'} | ${r.summary.replace(/\|/g, '/')} |`),
  ].join('\n');
}

function buildMarkdown(all: Result[]): string {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const total = all.length;
  const counts = ['OK', 'AVISO', 'ERRO', 'SKIP'].map(s => `${icon(s as Result['status'])} ${s}: ${all.filter(r => r.status === s).length}`).join(' — ');
  const sections = TEST_CNPJS.map(cnpj => {
    const rows = all.filter(r => r.cnpj === cnpj);
    return `## CNPJ ${cnpj}\n\n${mdTable(rows)}\n`;
  }).join('\n');
  return `# Audit Serpro/PGFN — APIs expostas no frontend\n\n**Data:** ${now}  \n**CNPJs testados:** ${TEST_CNPJS.join(', ')}  \n**Total de chamadas planejadas:** ${total}  \n**Resumo:** ${counts}\n\n## Escopo\n\nForam testados os serviços disponibilizados na tela Admin Serpro: Dados cadastrais, PGMEI, SITFIS/CND, Dívida Ativa/PGFN, Parcelamentos, Declarações, Caixa Postal, Processos e Pagamento.\n\nServiços que exigem dados complementares específicos (CPF do empresário, protocolo SITFIS, número DAS/recibo) foram marcados como SKIP quando não era seguro inferir esses dados automaticamente.\n\n${sections}\n## Observações\n\n- A PGFN oficial foi testada via API avulsa (PGFN_API) com token próprio.\n- DIVIDA_ATIVA e PGFN_CONSULTAR permanecem no frontend como serviços legados do Integra Contador e podem cair no endpoint DIVIDAATIVA24.\n- Resultados de erro por ausência de dados/procuração são classificados como AVISO quando representam condição operacional esperada.\n`;
}

async function main() {
  const all: Result[] = [];
  for (const cnpj of TEST_CNPJS) {
    console.log(`\nCNPJ ${cnpj}`);
    for (const service of SERVICES) {
      const result = await runService(cnpj, service);
      all.push(result);
      console.log(`${icon(result.status)} ${result.service} ${result.ms ? `${result.ms}ms` : ''} — ${result.summary.slice(0, 120)}`);
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, buildMarkdown(all), 'utf8');
  console.log(`\nRelatório gerado: ${OUT_FILE}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
