import { ToolDefinition } from '../../openai-client';
import { AgentContext } from '../../types';
export declare const SUPORTE_RULES = "\n# Regras de Suporte e Transbordo Humano\n- **CHAMAR ATENDENTE:** Quando o cliente pedir para falar com um humano, usar a palavra \"atendente\" ou se voc\u00EA perceber que n\u00E3o consegue resolver algo complexo (ex: d\u00FAvidas t\u00E9cnicas espec\u00EDficas n\u00E3o cobertas, cliente com muita resist\u00EAncia), use a ferramenta 'chamar_atendente'.\n- **IMPORTANTE:** Forne\u00E7a um resumo detalhado no campo 'reason' sobre o motivo da transfer\u00EAncia e o status da conversa para que o atendente humano tenha contexto.\n";
export declare const getSuporteTools: (context: AgentContext) => ToolDefinition[];
//# sourceMappingURL=workflow-suporte.d.ts.map