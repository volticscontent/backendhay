import { query } from './src/lib/db';
import { checkCnpjSerpro } from './src/ai/server-tools';

async function main() {
  try {
    const cnpjToTest = "14511139000104";
    console.log(`Testando CNPJ direto: ${cnpjToTest}`);
    
    // Test CCMEI
    const resultCCMEI = await checkCnpjSerpro(cnpjToTest, 'CCMEI_DADOS');
    console.log("Resultado da consulta CCMEI:", resultCCMEI);
  } catch (err) {
    console.error("Erro:", err);
  } finally {
    process.exit(0);
  }
}

main();
