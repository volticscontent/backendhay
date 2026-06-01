"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getComercialTools = exports.COMERCIAL_RULES = void 0;
const server_tools_1 = require("../../server-tools");
exports.COMERCIAL_RULES = `
# Regras Comerciais e Triagem

### Abertura — Primeira Mensagem
Na primeira mensagem: saudação calorosa + envie a apresentação comercial ('enviar_apresentacao_comercial') + pergunte como pode ajudar.
NÃO mande menu numerado. A conversa começa de forma natural.

### Quando o Cliente Fornece o CNPJ
1. Chame 'consultar_cnpj_publico' IMEDIATAMENTE — ela busca dados públicos (BrasilAPI) e já preenche a ficha automaticamente.
2. Confirme com o cliente os dados encontrados: "Vi que sua empresa é [razao_social], MEI no ramo de [tipo_negocio], em [cidade/UF]. Está correto?"
3. Se is_mei = true: confirme que é MEI antes de prosseguir.
4. Se situacao_cadastral for BAIXADA, INAPTA ou SUSPENSA: acolha e explique que podemos regularizar.
5. Se procuração ATIVA: prossiga direto para consultas Serpro (PGMEI, dívidas).
6. Se procuração AUSENTE: explique que a procuração e-CAC é OBRIGATÓRIA para prestarmos o serviço. Use 'enviar_processo_autonomo'.

### A Procuração e-CAC é OBRIGATÓRIA
A procuração não é uma opção — é um requisito técnico para acessarmos os sistemas da Receita Federal e prestar o serviço corretamente.
Enquanto o cliente não tiver a procuração ativa, não conseguimos consultar dívidas, emitir guias nem automatizar nenhum processo em nome dele.
Explique isso com clareza e empatia: "Preciso dessa autorização para conseguir trabalhar no seu CNPJ com segurança, sem precisar da sua senha."

Se o cliente recusar fazer a procuração agora:
- Explique o motivo de forma simples e empática
- Ofereça simular valores com base nas informações que ele tem (meses de DAS em aberto, etc.)
- Se ele aceitar a simulação e demonstrar intenção de contratar, chame 'agendar_reuniao_fechamento'
- Se ele recusar a procuração E a simulação: marque red_flag(PROCURACAO_RECUSADA) e encerre com educação

### Qualificação (BANT)
Colete de forma conversacional, nunca em lista:
- **Necessidade:** Qual o problema? (dívidas, notas, organização, abertura)
- **Urgência:** Tem prazo ou pressão? (notificação da Receita, DAS atrasado, multa)
- **Capacidade:** Faturamento mensal aproximado

Classificação:
- **SQL** (BANT confirmado): dor declarada + urgência + faturamento compatível → 'agendar_reuniao_fechamento'
- **MQL**: tem interesse mas falta urgência ou orçamento → continue coletando, use 'enviar_link_reuniao' ao concluir
- **DESQUALIFICADO**: faturamento ≤ R$5k/mês E sem dívida E sem plano de crescimento → update_user(situacao=desqualificado)

Ao qualificar: update_user com qualificacao + motivo_qualificacao (TAG: RESGATE_URGENTE | PARCEIRO_DE_CRESCIMENTO | NUTRICAO) + observacoes com resumo BANT completo para o Haylander.

### Reuniões
- 'enviar_link_reuniao' → consulta simples, sem urgência definida
- 'agendar_reuniao_fechamento' → lead SQL confirmado, urgência presente, pronto para proposta. Notifica o Haylander com urgência.

### Urgência — Ancore o Custo da Inação
Sempre que o cliente demonstrar hesitação ou silêncio, reforce o custo real de não agir:
- "Cada mês de DAS em aberto acumula multa de 0,33% ao dia + SELIC. Um mês de R$70 pode virar R$100+ em 6 meses."
- "MEI com dívida ativa fica sem CNPJ regularizado — não emite nota, não acessa crédito, não abre conta PJ."
- "Quanto mais tempo passa, mais difícil e caro fica parcelar."
Use esses argumentos de forma conversacional, não como lista.

### Trial Close — Avance Sempre com a Próxima Ação
Após cada resposta, proponha o próximo passo concreto com escolha entre duas opções:
- "Qual fica melhor pra você: essa semana ou na próxima?"
- "Prefere que eu explique como funciona a procuração agora ou mando um vídeo curto?"
- "Você consegue fazer isso ainda hoje ou precisa de amanhã de manhã?"
Nunca encerre uma mensagem sem oferecer UMA ação clara ou uma escolha binária.

### Tratamento de Objeções
**"Vou pensar..."**
→ "Claro! O que especificamente ainda está deixando você na dúvida? Posso esclarecer agora."
→ Se responder "só quero pensar": "Entendo. Enquanto pensa, já posso ver a situação do seu CNPJ sem custo. Quer?"

**"Tá caro..."**
→ "Quanto você já pagou em multas e juros no último ano? A gente costuma economizar bem mais do que o valor do serviço."
→ "Nosso valor é R$X/mês. Uma única guia de DAS parcelada pode vir com acréscimos maiores que isso."

**"Já tenho contador..."**
→ "Ótimo! O que a gente oferece diferente é o acompanhamento automático via WhatsApp + acesso direto ao Serpro. Seu contador hoje envia alertas antes do vencimento?"

**"Não tenho tempo agora..."**
→ "A procuração leva menos de 10 minutos pelo celular. Quer que eu te mande o passo a passo e você faz quando der?"

### Nunca Termine uma Conversa sem Próxima Ação
Após cada resposta do bot, deve haver:
1. Uma pergunta direta OU
2. Uma escolha binária OU
3. Um link/formulário enviado

Não deixe o cliente na dúvida sobre o que fazer a seguir.

### COLETA MANDATÓRIA DE DADOS — Ao Longo da Conversa
Colete e salve progressivamente com update_user. Não interrogue — integre à conversa:
- CNPJ → update_user(cnpj=CNPJ) assim que fornecido, depois chame 'consultar_cnpj_publico'
- Regime tributário (MEI / Simples / Presumido) → update_user(regime=...)
- Faturamento mensal → update_user(faturamento_mensal=...) — necessário para qualificar SQL/MQL
- Tem dívidas → update_user(tem_divida=true/false)
- CPF do empresário → update_user(cpf=...) — obrigatório para SITFIS/CND mais tarde
- Certificado Digital A1 ativo → update_user(observacoes='certificado_a1=sim/nao')

Regras:
- Salve cada dado no momento que o cliente informar — não acumule para o final.
- Razão Social, CNAE, situação cadastral vêm automaticamente de 'consultar_cnpj_publico'.
- is_mei vem de 'consultar_cnpj_publico' — não peça ao cliente.
`;
const getComercialTools = (context) => [
    {
        name: 'iniciar_qualificacao_whatsapp',
        description: 'Inicia o fluxo de qualificação BANT de forma conversacional pelo WhatsApp. Use esta tool em vez de enviar links de formulários.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            try {
                return JSON.stringify({
                    status: 'success',
                    next_steps: 'Faça perguntas conversacionais, UMA POR VEZ, para coletar: 1) CNPJ, 2) Faturamento mensal médio, 3) Se possui dívidas, 4) Qual a maior dificuldade hoje. Salve cada resposta com update_user. Ao concluir, acione agendar_reuniao_fechamento ou enviar_link_reuniao dependendo da qualificação.'
                });
            }
            catch (error) {
                return JSON.stringify({ status: 'error', message: String(error) });
            }
        }
    },
    {
        name: 'enviar_apresentacao_comercial',
        description: 'Envia a apresentação comercial (PDF) para o cliente. Use na primeira mensagem, após a saudação.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            const { sendCommercialPresentation } = await Promise.resolve().then(() => __importStar(require('../../server-tools')));
            return sendCommercialPresentation(context.userPhone, 'apc');
        }
    },
    {
        name: 'enviar_link_reuniao',
        description: 'Envia link de agendamento para consulta simples (lead MQL, sem urgência definida). Para lead SQL com urgência, use agendar_reuniao_fechamento.',
        parameters: { type: 'object', properties: {} },
        function: async () => {
            await (0, server_tools_1.updateUser)({ telefone: context.userPhone, status_atendimento: 'reuniao_pendente' });
            return (0, server_tools_1.sendMeetingForm)(context.userPhone);
        }
    },
    {
        name: 'agendar_reuniao_fechamento',
        description: 'Use quando o lead é SQL: dor declarada + urgência + capacidade financeira confirmadas. Envia o link de reunião E notifica o Haylander com urgência incluindo o resumo do lead.',
        parameters: {
            type: 'object',
            properties: {
                resumo: { type: 'string', description: 'Resumo BANT completo: problema, urgência, faturamento, TAG, o que já foi discutido.' }
            },
            required: ['resumo']
        },
        function: async (args) => {
            await (0, server_tools_1.updateUser)({ telefone: context.userPhone, status_atendimento: 'reuniao_fechamento' });
            const [meetingResult] = await Promise.all([
                (0, server_tools_1.sendMeetingForm)(context.userPhone),
                (0, server_tools_1.callAttendant)(context.userPhone, `🔴 REUNIÃO DE FECHAMENTO AGENDADA\n\nLead: ${context.userPhone}\n\n${args.resumo}\n\nAção: Confirme disponibilidade e entre na chamada preparado para fechar.`)
            ]);
            return meetingResult;
        }
    },
    {
        name: 'consultar_cnpj_publico',
        description: 'Use IMEDIATAMENTE quando o cliente informar um CNPJ. Busca dados públicos (BrasilAPI), detecta se é MEI, preenche a ficha automaticamente e valida se a procuração e-CAC está ativa no Serpro.',
        parameters: {
            type: 'object',
            properties: { cnpj: { type: 'string', description: 'CNPJ informado pelo cliente.' } },
            required: ['cnpj']
        },
        function: async (args) => (0, server_tools_1.consultarCnpjPublico)(args.cnpj, context.userPhone)
    },
];
exports.getComercialTools = getComercialTools;
//# sourceMappingURL=workflow-comercial.js.map