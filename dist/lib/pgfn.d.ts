export type PgfnToken = {
    token_type: string;
    access_token: string;
    expires_in: number;
    expiresAt: number;
};
export type PgfnInscricao = {
    numeroInscricao: string | null;
    numeroProcesso: string | null;
    devedorPrincipal: string | null;
    tipoDevedor: string | null;
    situacaoDescricao: string | null;
    tipoRegularidade: string | null;
    receitaPrincipal: string | null;
    codigoReceitaPrincipal: string | null;
    dataInscricao: string | null;
    valorTotalConsolidado: number | null;
    valorTotalConsolidadoMoeda: string | null;
    ajuizada: boolean | null;
    negociada: boolean | null;
    raw: Record<string, unknown>;
};
export type PgfnResumo = {
    total_inscricoes: number;
    total_ativas: number;
    total_ajuizadas: number;
    total_negociadas: number;
    valor_total_consolidado: number;
    valor_total_consolidado_moeda: string;
    situacoes: string[];
    regularidades: string[];
    inscricoes: PgfnInscricao[];
    resumo_texto: string;
};
export type PgfnConsultaResult = {
    status: 'success';
    origem: 'pgfn_api';
    consulta: 'devedor' | 'inscricao';
    parametro: string;
    dados: unknown;
    tem_debitos_detectado: boolean | null;
    mensagens_pgfn: string[];
    resumo: PgfnResumo;
};
export declare function getPgfnToken(forceRefresh?: boolean): Promise<PgfnToken>;
export declare function consultarDividaAtivaPorDevedor(cpfOuCnpj: string): Promise<PgfnConsultaResult>;
export declare function consultarDividaAtivaPorInscricao(numeroInscricao: string): Promise<PgfnConsultaResult>;
//# sourceMappingURL=pgfn.d.ts.map