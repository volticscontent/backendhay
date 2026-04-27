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

export function createRegularizacaoMessageSegments(): MessageSegment[] {
    return [
        { id: 'intro-regularizacao', content: 'Olá! 👋 Vi que você está interessado em regularização fiscal. Vou te explicar como funciona o nosso processo para resolver suas pendências com segurança.', type: 'text', delay: 500 },
        { id: 'explicacao-fluxo', content: 'O primeiro passo é realizarmos uma consulta completa das dívidas no **PGMEI** e na **Dívida Ativa da União**. ||| Para isso, precisamos de sua autorização. Temos dois caminhos seguros:', type: 'text', delay: 1500 },
        { id: 'opcoes-autorizacao', content: '*Opção A — Procuração Eletrônica (Recomendado)* \nÉ a forma mais segura. Você mesmo autoriza nosso escritório no portal e-CAC sem precisar nos passar sua senha pessoal. \n\n*Opção B — Conversa pelo WhatsApp* \nPrefere não acessar o e-CAC agora? Sem problemas! Posso coletar as informações aqui mesmo pelo chat para preparar seu atendimento com um consultor.', type: 'text', delay: 2000 },
        { id: 'pergunta-escolha', content: 'Qual dessas opções você prefere para darmos continuidade?', type: 'text', delay: 1000 },
    ];
}

export function createAutonomoMessageSegments(): MessageSegment[] {
    return [
        { id: 'autonomo-inicio', content: 'Perfeito! ✅ Vou te enviar o passo a passo completo.', type: 'text', delay: 1000 },
        { id: 'link-ecac', content: 'Acesse o e-CAC através deste *link oficial* do Governo Federal:', type: 'text', delay: 1500 },
        { id: 'link-ecac-url', content: 'https://cav.receita.fazenda.gov.br/autenticacao/login', type: 'link', delay: 2000, metadata: { url: 'https://cav.receita.fazenda.gov.br/autenticacao/login', trackingKey: 'link-ecac' } },
        { id: 'instrucoes-ecac', content: 'No e-CAC, acesse *Outros > Outorgar Procuração* e pesquise nosso escritório pelo CPF/CNPJ. Autorize os serviços de *Consulta e Gestão* e salve.', type: 'text', delay: 2500 },
        { id: 'instrucoes-finais', content: 'Após criar a procuração, *volte aqui e me avise* que conseguiu! 🚀 Confirmarei a autorização e daremos início à consultoria.', type: 'text', delay: 3000 },
    ];
}

export function createSituacaoFormSegments(): MessageSegment[] {
    return [
        { id: 'situacao-inicio', content: 'Sem problemas! 👍 Posso coletar as informações necessárias aqui mesmo pelo WhatsApp, sem precisar de senha ou formulário externo.', type: 'text', delay: 500 },
        { id: 'situacao-explicacao', content: 'Vou te fazer algumas perguntas rápidas sobre a situação da sua empresa. Pode responder no seu tempo, sem pressa. 😊', type: 'text', delay: 1500 },
    ];
}

export function createAssistidoMessageSegments(): MessageSegment[] {
    return [
        { id: 'assistido-inicio', content: 'Ótima escolha! ⭐ Um de nossos **especialistas** irá auxiliá-lo durante todo o processo.', type: 'text', delay: 1000 },
        { id: 'preparacao-atendimento', content: 'Vou transferir você para o atendimento humano para te guiarmos passo a passo.', type: 'text', delay: 1500 },
        { id: 'aguarde-atendente', content: 'Por favor, **aguarde alguns instantes** enquanto preparamos seu atendimento...', type: 'text', delay: 2000 },
    ];
}
