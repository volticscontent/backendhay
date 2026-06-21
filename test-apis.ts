import { getSerproTokens, consultarServico } from './src/lib/serpro';
import { consultarDividaAtivaPorDevedor } from './src/lib/pgfn';
import { cnpjService } from './src/lib/cnpj-service';

async function main() {
  console.log("==========================================");
  console.log("TESTANDO APIs DO SISTEMA");
  console.log("==========================================\n");

  // 1. BrasilAPI
  console.log("[1] Testando CNPJ via BrasilAPI (cnpj-service.ts)...");
  try {
    const cnpjRes = await cnpjService.consultarCNPJ("51564549000140");
    if (cnpjRes.success) {
      console.log("✅ BrasilAPI: Sucesso! Razão Social:", cnpjRes.data?.razao_social);
    } else {
      console.log("❌ BrasilAPI falhou:", cnpjRes.error);
    }
  } catch (e) {
    console.error("❌ BrasilAPI Erro crítico:", e);
  }

  console.log("\n------------------------------------------\n");

  // 2. Serpro Auth
  console.log("[2] Testando Autenticação no Integra Contador (Serpro)...");
  try {
    const tokens = await getSerproTokens();
    console.log("✅ Integra Contador: Sucesso na autenticação mTLS/OAuth!");
    // console.log("Tokens obtidos:", tokens.access_token.substring(0, 20) + "...");
  } catch (e) {
    console.error("❌ Integra Contador Erro crítico:", e instanceof Error ? e.message : e);
  }

  console.log("\n------------------------------------------\n");

  // 3. PGFN
  console.log("[3] Testando Autenticação/Consulta Dívida Ativa (PGFN API Independente)...");
  try {
    const pgfnRes = await consultarDividaAtivaPorDevedor("51564549000140");
    console.log("✅ PGFN: Sucesso! Resposta da API Dívida Ativa obtida.");
  } catch (e) {
    console.error("❌ PGFN Erro crítico:", e instanceof Error ? e.message : e);
  }

  console.log("\n==========================================");
  console.log("FIM DOS TESTES");
  console.log("==========================================\n");
  
  process.exit(0);
}

main();
