export interface ServiceConfigItem {
    env_sistema: string;
    env_servico: string;
    default_sistema?: string;
    default_servico?: string;
    tipo: 'Consultar' | 'Emitir' | 'Solicitar';
    versao?: string;
    descricao?: string;
    uso?: string;
    finalidade?: string;
}
export declare const SERVICE_CONFIG: Record<string, ServiceConfigItem>;
//# sourceMappingURL=serpro-config.d.ts.map