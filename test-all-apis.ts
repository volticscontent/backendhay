import { consultarServico, getSerproTokens } from './src/lib/serpro';
import { consultarDividaAtivaPorDevedor } from './src/lib/pgfn';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const cnpjTeste = "51564549000140";
  const results = [];

  console.log("==========================================");
  console.log("TESTE INDIVIDUAL DE CADA SERVIÇO (API POR API)");
  console.log("CNPJ DE TESTE: " + cnpjTeste);
  console.log("==========================================\n");

  try {
    await getSerproTokens();
    console.log("✅ Autenticação Global Integra Contador: OK\n");
  } catch (e) {
    console.error("❌ Falha crítica na autenticação global. Abortando.", e);
    process.exit(1);
  }

  const apisToTest = [
    { key: "CCMEI_DADOS", opts: {} },
    { key: "PGMEI", opts: { ano: "2024" } }, // Consulta dívida PGMEI
    { key: "PGDASD", opts: { ano: "2024" } }, // Consulta extrato Simples
    { key: "DCTFWEB", opts: { ano: "2024", mes: "01" } }, 
    { key: "PARCELAMENTO_MEI_CONSULTAR", opts: {} },
    { key: "CAIXA_POSTAL", opts: {} },
    { key: "PROCESSOS", opts: {} }
  ];

  for (const api of apisToTest) {
    console.log(`[>>] Testando API: ${api.key}...`);
    try {
      const res = await consultarServico(api.key as any, cnpjTeste, api.opts);
      
      // If we got here without throwing, the request was accepted by Serpro Gateway
      // Let's summarize the response
      let summary = "Sucesso";
      if (res && typeof res === 'object') {
         if ((res as any).mensagens && (res as any).mensagens[0]) {
             summary = (res as any).mensagens[0].texto || "Mensagem retornada";
         } else if ((res as any).erro) {
             summary = "Erro de negócio: " + (res as any).erro;
         }
      }

      console.log(`     ✅ Status: Funcional | Retorno: ${summary}`);
      results.push({ api: api.key, status: "OK", detail: summary });
    } catch (e: any) {
      // It's normal to get 404 or 422 for logical reasons (e.g. not a MEI, no debt, no messages)
      // We want to distinguish between "Auth Error/Integration Error" and "Business Error"
      const msg = e?.response?.data || e.message || String(e);
      console.log(`     ⚠️ Status: Retornou erro da API | Detalhe: ${JSON.stringify(msg).substring(0, 150)}`);
      results.push({ api: api.key, status: "WARNING", detail: JSON.stringify(msg).substring(0, 150) });
    }
    await delay(1000); // 1 second delay to avoid rate limits
  }

  // PGFN
  console.log(`[>>] Testando API: PGFN (Dívida Ativa)...`);
  try {
    const pgfnRes = await consultarDividaAtivaPorDevedor(cnpjTeste);
    console.log(`     ✅ Status: Funcional`);
    results.push({ api: "PGFN", status: "OK", detail: "Sucesso" });
  } catch (e: any) {
    const msg = e?.response?.data || e.message || String(e);
    console.log(`     ⚠️ Status: Retornou erro da API | Detalhe: ${JSON.stringify(msg).substring(0, 150)}`);
    results.push({ api: "PGFN", status: "WARNING", detail: JSON.stringify(msg).substring(0, 150) });
  }

  console.log("\n==========================================");
  console.log("FIM DOS TESTES");
  console.log("==========================================");
}

main().catch(console.error);
