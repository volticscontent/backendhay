/**
 * Limpa e repopula a tabela services com dados reais.
 * Execute: npx ts-node src/scripts/seed-services.ts
 */
import pool from '../lib/db';

const SERVICES = [
  {
    name: 'Plano Basic',
    value: 150.00,
    description: 'Contabilidade mensal para MEI. Inclui: emissão de guias DAS e notas fiscais, acompanhamento de faturamento, DASN-SIMEI e suporte via WhatsApp (respostas em até 24h). Ideal para MEI com operação simples.',
  },
  {
    name: 'Plano Premium',
    value: 450.00,
    description: 'MAIS VENDIDO (80% dos clientes). Tudo do Basic mais suporte via WhatsApp e E-mail, planejamento tributário básico e acompanhamento de pendências fiscais. Ideal para MEI/ME com faturamento regular que quer acompanhamento próximo.',
  },
  {
    name: 'Plano Diamond',
    value: 1797.00,
    description: 'Plano completo para infoprodutores e empreendedores digitais com faturamento elevado. Tudo do Premium mais: suporte por videoconferência, assessoria financeira e contábil completa, consultoria financeira quinzenal e planejamento tributário avançado com redução legal de impostos.',
  },
  {
    name: 'Regularização de CNPJ',
    value: 0,
    description: 'Serviço avulso para MEI com CNPJ irregular. Inclui: diagnóstico completo via Serpro (PGMEI + Dívida Ativa), negociação e parcelamento de dívidas fiscais, regularização perante a Receita Federal. Valor sob consulta conforme volume de dívidas.',
  },
  {
    name: 'Abertura de MEI',
    value: 0,
    description: 'Abertura completa de Microempreendedor Individual. Inclui orientação sobre enquadramento, CNAE ideal para o negócio e obrigações mensais. Valor a confirmar.',
  },
  {
    name: 'DASN-SIMEI Avulso',
    value: 0,
    description: 'Envio da declaração anual de faturamento do MEI (prazo: até 31 de maio). Para quem não possui plano mensal ativo. Evita multa por atraso.',
  },
  {
    name: 'Transformação MEI para ME/LTDA',
    value: 0,
    description: 'Para quem ultrapassou o limite do MEI ou precisa de mais estrutura jurídica. Inclui análise do melhor regime tributário (Simples Nacional, Lucro Presumido) e todo o processo de abertura da nova empresa. Valor sob consulta.',
  },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE services RESTART IDENTITY');
    for (const s of SERVICES) {
      await client.query(
        `INSERT INTO services (name, value, description) VALUES ($1, $2, $3)`,
        [s.name, s.value, s.description],
      );
    }
    await client.query('COMMIT');
    console.log(`✅ ${SERVICES.length} serviços inseridos com sucesso.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Erro:', e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
