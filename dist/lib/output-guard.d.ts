/**
 * Trava determinística contra alucinação de "horário de funcionamento" da PGFN/Receita.
 *
 * Contexto: o serviço da PGFN/Dívida Ativa NÃO tem horário restrito — quando a consulta
 * falha é por instabilidade transitória (tratada com retry em `pgfn.ts`). Mesmo com a regra
 * explícita no prompt, o LLM reproduzia a frase falsa "a PGFN só funciona das 07:05 às 22:00"
 * (confirmado ao vivo 2026-06-25), principalmente quando o histórico recente já continha a
 * mentira e o reabastecia. Regra de prompt é probabilística; isto aqui é determinístico:
 * NENHUMA mensagem com esse padrão chega ao cliente nem é gravada no histórico.
 *
 * Aplicado em dois pontos:
 *  - saída do agente (sendAgentResponse) — última linha de defesa antes de enviar/gravar;
 *  - carregamento do histórico (openai-client) — impede que mensagens antigas poluídas
 *    voltem a condicionar o LLM.
 *
 * Precisão: marcadores escolhidos para pegar todas as variações observadas da fabricação
 * SEM bloquear horários legítimos (ex: "sua reunião é às 22:00", "horário comercial").
 */
/** True se o trecho contém a alucinação de horário da PGFN/Receita. */
export declare function isScheduleHallucination(text: string): boolean;
/**
 * Remove sentenças com a alucinação de horário e, se algo foi removido, garante a frase
 * segura. Determinístico — não depende do LLM obedecer. Preserva o restante da mensagem.
 */
export declare function sanitizeHallucination(text: string): string;
//# sourceMappingURL=output-guard.d.ts.map