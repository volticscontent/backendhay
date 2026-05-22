// Script temporário para testar a API Serpro PROCURACAO
const res = await fetch('http://127.0.0.1:3001/api/serpro', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ cnpj: '51564549000140', service: 'PROCURACAO' }),
});

const data = await res.json();
console.log('Status:', res.status);
console.log('Response:', JSON.stringify(data, null, 2));
