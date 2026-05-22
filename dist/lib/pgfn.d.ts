export type PgfnToken = {
    token_type: string;
    access_token: string;
    expires_in: number;
    expiresAt: number;
};
export type PgfnConsultaResult = {
    status: 'success';
    origem: 'pgfn_api';
    consulta: 'devedor' | 'inscricao';
    parametro: string;
    dados: unknown;
    tem_debitos_detectado: boolean | null;
    mensagens_pgfn: string[];
};
export declare function getPgfnToken(forceRefresh?: boolean): Promise<PgfnToken>;
export declare function consultarDividaAtivaPorDevedor(cpfOuCnpj: string): Promise<PgfnConsultaResult>;
export declare function consultarDividaAtivaPorInscricao(numeroInscricao: string): Promise<PgfnConsultaResult>;
//# sourceMappingURL=pgfn.d.ts.map