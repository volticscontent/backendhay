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

// 1. Dedo-podre: "07:05" é o horário fabricado da PGFN — não tem uso legítimo no domínio.
const FAKE_PGFN_START = /\b0?7\s*[:hH]\s*05\b/;

// 2. Janela de horário "entre 07:05 e 22:00" / "das 7h às 22h" — afirmar que uma consulta
//    fiscal só roda num intervalo do dia é sempre fabricação (reunião legítima é um horário
//    único, não um intervalo de funcionamento).
const TIME_WINDOW = /\b(entre|das)\s+\d{1,2}\s*[:hH]\s*\d{0,2}\s*(e|[àa]s|at[ée])\s+\d{1,2}\s*[:hH]?\s*\d{0,2}\b/;

// 3. Frase de "horário" atrelada aos sistemas de consulta (qualquer ordem). Exige a co-ocorrência
//    de um termo de sistema E uma reivindicação de horário, para não pegar horário humano legítimo.
const SYS = '(pgfn|d[íi]vida\\s+ativa|receita|serpro|sistema|consulta)';
const SCHEDULE = '(fora\\s+do\\s+hor[áa]rio|hor[áa]rio\\s+(de\\s+)?(funcionamento|atendimento)|hor[áa]rio\\s+(correto|permitido|autorizado))';
const SYS_SCHEDULE_FWD = new RegExp(`${SYS}[^.!?\\n]{0,80}${SCHEDULE}`, 'i');
const SYS_SCHEDULE_REV = new RegExp(`${SCHEDULE}[^.!?\\n]{0,80}${SYS}`, 'i');

// 4. Frase de horário "correto/permitido/autorizado" — só existe nessa fabricação ("tente
//    novamente durante o horário correto"); nenhum fluxo legítimo do bot usa.
const FAKE_SCHEDULE_PHRASE = /\bhor[áa]rio\s+(correto|permitido|autorizado)\b/i;

const HALLUCINATION_MARKERS: RegExp[] = [
  FAKE_PGFN_START,
  TIME_WINDOW,
  SYS_SCHEDULE_FWD,
  SYS_SCHEDULE_REV,
  FAKE_SCHEDULE_PHRASE,
];

// Frase canônica aprovada para substituir a explicação falsa quando a PGFN não pôde ser confirmada.
const SAFE_PGFN_FALLBACK =
  'No momento não consegui confirmar a situação na Dívida Ativa da União (PGFN) por uma instabilidade momentânea nos sistemas da Receita. Vou reconsultar e, se necessário, encaminhar a um especialista.';

/** True se o trecho contém a alucinação de horário da PGFN/Receita. */
export function isScheduleHallucination(text: string): boolean {
  return HALLUCINATION_MARKERS.some(re => re.test(text));
}

/**
 * Remove sentenças com a alucinação de horário e, se algo foi removido, garante a frase
 * segura. Determinístico — não depende do LLM obedecer. Preserva o restante da mensagem.
 */
export function sanitizeHallucination(text: string): string {
  if (!text || !isScheduleHallucination(text)) return text;

  const parts = text.split(/(?<=[.!?])\s+|\n+/);
  const kept: string[] = [];
  let removedAny = false;

  for (const part of parts) {
    if (isScheduleHallucination(part)) {
      removedAny = true;
      continue;
    }
    if (part.trim()) kept.push(part.trim());
  }

  // Se a alucinação não pôde ser isolada numa sentença (ou removeu tudo), substitui a mensagem.
  if (!removedAny || kept.length === 0) return SAFE_PGFN_FALLBACK;

  const rebuilt = kept.join(' ');
  // Se sobrou menção a PGFN/Dívida sem explicar a falha, ancora a frase segura.
  const mencionaPgfn = /(pgfn|d[íi]vida\s+ativa)/i.test(rebuilt);
  const jaTemExplicacao = /(instabilidade|reconsultar|especialista|tentar novamente)/i.test(rebuilt);
  return mencionaPgfn && !jaTemExplicacao ? `${rebuilt} ${SAFE_PGFN_FALLBACK}` : rebuilt;
}
