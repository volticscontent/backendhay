export declare const VALIDITY_DAYS: Record<string, number>;
/**
 * Se a resposta de um serviço contiver PDF base64, faz upload para R2
 * e persiste o registro em serpro_documentos. Silencioso em caso de falha.
 */
export declare function maybeSavePdfFromBotResult(cnpj: string, service: string, result: unknown, protocolo?: string): Promise<void>;
export declare function saveConsultation(cnpj: string, service: string, result: unknown, status: number, source?: string): Promise<void>;
export interface SerproDocumentoInput {
    cnpj: string;
    tipo_servico: string;
    protocolo?: string | null;
    r2_key: string;
    r2_url: string;
    tamanho_bytes?: number | null;
    valido_ate?: string | null;
    gerado_por?: string;
    lead_id?: number | null;
    metadata?: Record<string, unknown> | null;
}
export declare function saveDocumento(input: SerproDocumentoInput): Promise<{
    id: string;
    valido_ate: string | null;
}>;
export interface ListDocumentosOptions {
    cnpj?: string;
    tipo_servico?: string;
    gerado_por?: string;
    limit?: number;
    offset?: number;
}
export declare function listDocumentos(opts?: ListDocumentosOptions): Promise<any[]>;
export declare function softDeleteDocumento(id: string): Promise<boolean>;
//# sourceMappingURL=serpro-db.d.ts.map