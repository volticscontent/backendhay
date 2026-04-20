import { ToolDefinition } from '../../openai-client';
import { callAttendant } from '../../server-tools';
import { AgentContext } from '../../types';

export const SUPORTE_RULES = `
# Regras de Suporte e Transbordo Humano
- **CHAMAR ATENDENTE:** Quando o cliente pedir para falar com um humano, usar a palavra "atendente" ou se você perceber que não consegue resolver algo complexo (ex: dúvidas técnicas específicas não cobertas, cliente com muita resistência), use a ferramenta 'chamar_atendente'.
- **IMPORTANTE:** Forneça um resumo detalhado no campo 'reason' sobre o motivo da transferência e o status da conversa para que o atendente humano tenha contexto.
`;

export const getSuporteTools = (context: AgentContext): ToolDefinition[] => [
    {
        name: 'chamar_atendente',
        description: 'Transferir a conversa para um atendente humano.',
        parameters: { type: 'object', properties: { reason: { type: 'string' } } },
        function: async (args: any) => await callAttendant(context.userPhone, args.reason)
    }
];
