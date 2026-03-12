/**
 * Salva o mapeamento LID → telefone real no Redis + PostgreSQL.
 * No PostgreSQL, faz UPDATE na tabela Contact da Evolution API
 * para associar o pushName ao contato LID.
 * O senderPn já é salvo automaticamente pela Evolution API na key da Message.
 */
export declare function saveLidPhoneMapping(lid: string, phone: string, pushName?: string | null): Promise<void>;
/**
 * Resolve um LID para telefone real.
 * Tenta Redis primeiro, depois consulta a tabela Message da Evolution API.
 */
export declare function resolveLidToPhone(lid: string): Promise<string | null>;
/**
 * Pré-carrega mapeamentos LID→telefone no Redis a partir das tabelas da Evolution API.
 * Consulta Messages que têm senderPn na key para construir o cache.
 */
export declare function warmLidCache(): Promise<void>;
//# sourceMappingURL=lid-map.d.ts.map