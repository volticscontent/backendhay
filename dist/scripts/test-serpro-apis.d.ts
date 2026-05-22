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
declare const BASE = "http://127.0.0.1:3001";
declare const CNPJ: string;
declare const CPF: string;
declare const ANO_ATUAL: string;
declare const ANO_ANTERIOR: string;
declare const MES_ATUAL: string;
declare const delay: (ms: number) => Promise<unknown>;
type Resultado = {
    service: string;
    status: '✅ OK' | '❌ ERRO' | '⚠️  SKIP' | '⚠️  AVISO';
    ms: number;
    info: string;
};
declare function call(service: string, extra?: Record<string, string | undefined>): Promise<{
    ok: boolean;
    status: number;
    body: unknown;
    ms: number;
}>;
declare function resumo(body: unknown): string;
declare function testar(service: string, extra?: Record<string, string | undefined>, skipSe?: string): Promise<Resultado>;
declare function run(): Promise<void>;
//# sourceMappingURL=test-serpro-apis.d.ts.map