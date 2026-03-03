/**
 * Busca e formata a lista de serviços do banco de dados para injetar no contexto da IA.
 */
export declare function getServicesContext(): Promise<string>;
/**
 * Busca e formata a lista de arquivos/assets do R2 para o contexto da IA.
 */
export declare function getAssetsContext(): Promise<string>;
/**
 * Agrega todo o conhecimento dinâmico (Serviços + Assets)
 */
export declare function getDynamicContext(): Promise<string>;
//# sourceMappingURL=knowledge-base.d.ts.map