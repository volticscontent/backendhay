import { AgentMessage } from '../ai/types';
/**
 * Extrai o conteúdo da mensagem do payload da Evolution API.
 * Retorna um AgentMessage (string ou ContentPart[]) pronto para o agente processar.
 * Retorna null se a mensagem não pôde ser extraída.
 */
export declare function parseIncomingMessage(msgData: Record<string, unknown> | undefined, base64FromBody?: string): Promise<AgentMessage | null>;
//# sourceMappingURL=message-parser.d.ts.map