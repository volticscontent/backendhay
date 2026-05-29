import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function runAudit() {
  const { checkCnpjSerpro } = await import('./src/ai/server-tools');
  const { SERVICE_CONFIG } = await import('./src/lib/serpro-config');
  
  const cnpj = '23950473000155'; // A known CNPJ (you can change it)
  const results = [];
  
  const services = Object.keys(SERVICE_CONFIG);
  
  for (const service of services) {
    const config = SERVICE_CONFIG[service];
    console.log(`Testing ${service} (${config.tipo})...`);
    
    try {
      const start = Date.now();
      const raw = await checkCnpjSerpro(cnpj, service, { ano: '2024' });
      const elapsed = Date.now() - start;
      
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      
      let status = '✅ OK';
      let error = '';
      if (parsed.status === 'error' || parsed.error) {
        if (parsed.error_type === 'ACCESS_DENIED') {
           status = '❌ ERRO (Acesso Negado)';
        } else {
           status = '⚠️ ERRO/AVISO';
        }
        error = parsed.message || parsed.error || JSON.stringify(parsed);
      }
      
      results.push({ service, status, elapsed, error: error.substring(0, 100) });
    } catch (e) {
      results.push({ service, status: '❌ FALHA', elapsed: 0, error: e.message });
    }
  }
  
  console.log('\n\n--- RELATÓRIO DE AUDITORIA SERPRO ---');
  console.table(results);
  process.exit(0);
}

runAudit().catch(e => { console.error(e); process.exit(1); });