export interface ServiceConfigItem {
    env_sistema: string;
    env_servico: string;
    default_sistema?: string;
    default_servico?: string;
    /** Versão do serviço a ser enviada em `versaoSistema` no payload. Default: '1.0' */
    versaoSistema?: string;
    tipo: 'Consultar' | 'Emitir' | 'Solicitar' | 'Apoiar';
    descricao?: string;
    uso?: string;
    finalidade?: string;
}
export declare const SERVICE_CONFIG: Record<string, ServiceConfigItem>;
//# sourceMappingURL=serpro-config.d.ts.map