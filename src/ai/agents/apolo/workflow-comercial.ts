import { ToolDefinition } from '../../openai-client';
import { sendEnumeratedList, sendMeetingForm, consultarCnpjPublico } from '../../server-tools';
import { AgentContext } from '../../types';

export const COMERCIAL_RULES = `
# Regras Comerciais e Triagem
**FLUXO DE PENSAMENTO OBRIGATÓRIO (Chain of Thought):**
Antes de responder, você DEVE seguir este processo mental:
1. Faça 1 ou 2 perguntas curtas e amigáveis para descobrir o cenário básico (faturamento mensal aproximado e se tem dívidas), caso ele não tenha informado.
2. Com base nas respostas, classifique o lead AGORA (Respeite a ordem de PRECEDÊNCIA):
   - **REGRA 1 (CRÍTICA):** Faturamento É 'Até 5k' E SEM Dívida? -> **DESQUALIFICADO** (PARE AQUI!).
   - Faturamento > 10k? -> MQL
   - Tem Dívida (tem_divida = true)? -> MQL
   - Quer Abrir Empresa (Novo CNPJ)? -> MQL (Somente se NÃO cair na regra 1).
   - NENHUM dos acima? -> DESQUALIFICADO.
3. Se for QUALIFICADO (MQL ou SQL), você DEVE IMEDIATAMENTE chamar a tool update_user preenchendo 'qualificacao', 'motivo_qualificacao' e as informações extraídas.
4. **PASSAGEM DE BASTÃO:** Assim que chamar a update_user para qualificar, avise o cliente que um consultor entrará em contato.
5. Se for DESQUALIFICADO, chame update_user com {"situacao": "desqualificado"}.
6. **LINGUAGEM DE CONTADOR:** No campo 'observacoes' do update_user, salve resumos úteis para um contador, evitando termos técnicos.

### Consulta de Dados Públicos e Validação de Procuração (CNPJ)
- Se o cliente fornecer um CNPJ, use a tool 'consultar_cnpj_publico' IMEDIATAMENTE.
- **PRINCIPAL VALIDADOR:** Esta ferramenta busca dados básicos (BrasilAPI) e **valida se a procuração e-CAC está ativa** (via Serpro).
- **SE Procuração estiver ATIVA:** Você pode prosseguir com consultas profundas (PGMEI, Dívidas) e parabenizar o cliente por já ter o acesso configurado.
- **SE Procuração estiver AUSENTE:** Você DEVE informar ao cliente que o acesso seguro ainda não foi detectado e orientá-lo a criar a procuração e-CAC (Opção A) usando o vídeo tutorial.
- Se o resultado indicar que a empresa está 'BAIXADA', 'INAPTA' ou 'SUSPENSA', acolha o cliente e ofereça ajuda para regularizar.

### Acolhimento e Menu Inicial
- **REGRA DE OURO:** Se for a primeira mensagem, envie uma saudação e CHAME A TOOL 'enviar_lista_enumerada'.

### Diferenciação: Atendimento por Chat vs Reunião
- **Lead novo (não qualificado):** Conduza o atendimento inteiramente por chat. NÃO ofereça reunião proativamente.
- **Lead qualificado (MQL ou SQL):** Após chamar update_user, apenas avise: "Um consultor da nossa equipe entrará em contato para agendar uma conversa com você."
- **Coleta de situação concluída (Opção B do fluxo regularização):** Assim que você tiver coletado ao menos CNPJ, faturamento e situação de dívidas, chame 'enviar_link_reuniao' proativamente e depois chame update_user com {"status_atendimento": "reuniao_pendente"}.
- **Cliente pede reunião explicitamente:** Chame 'enviar_link_reuniao' e em seguida chame update_user com {"status_atendimento": "reuniao"}.
- **Cliente já é cliente (pós-venda):** Chame 'chamar_atendente' com reason="reuniao_cliente" para encaminhar ao time de atendimento.
`;

export const getComercialTools = (context: AgentContext): ToolDefinition[] => [
    { name: 'enviar_lista_enumerada', description: 'Exibir a lista de opções numerada (1-5) para o cliente via WhatsApp.', parameters: { type: 'object', properties: {} }, function: async () => await sendEnumeratedList(context.userPhone) },
    { name: 'enviar_link_reuniao', description: 'Gera e envia o link de agendamento de reunião. Use proativamente após coleta de situação completa.', parameters: { type: 'object', properties: {} }, function: async () => await sendMeetingForm(context.userPhone) },
    {
        name: 'consultar_cnpj_publico',
        description: 'Consulta dados cadastrais públicos e VALIDA status da Procuração e-CAC. Use sempre que o cliente informar um CNPJ.',
        parameters: { type: 'object', properties: { cnpj: { type: 'string', description: 'CNPJ a ser consultado (apenas números ou formatado).' } }, required: ['cnpj'] },
        function: async (args: any) => await consultarCnpjPublico(args.cnpj)
    },
];
