/**
 * Sistema de Mensagens Segmentadas para Regularização
 */
export interface MessageSegment {
    id: string;
    content: string;
    type: 'text' | 'media' | 'link';
    delay?: number;
    metadata?: Record<string, unknown>;
}
export declare function createRegularizacaoMessageSegments(): MessageSegment[];
export declare function createAutonomoMessageSegments(): MessageSegment[];
export declare function createAssistidoMessageSegments(): MessageSegment[];
//# sourceMappingURL=regularizacao-system.d.ts.map