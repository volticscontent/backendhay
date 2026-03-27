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
        { id: 'opcoes-autorizacao', content: '*Opção A — Procuração Eletrônica (Recomendado)* \nÉ a forma mais segura. Você mesmo autoriza nosso escritório no portal e-CAC sem precisar nos passar sua senha pessoal. \n\n*Opção B — Acesso Direto (Consulta Imediata)* \nVocê nos envia seu CPF e Senha GOV através de um formulário seguro e nós realizamos a consulta técnica agora mesmo.', type: 'text', delay: 2000 },
        { id: 'pergunta-escolha', content: 'Qual dessas opções você prefere para darmos continuidade?', type: 'text', delay: 1000 },
    ];
}

export function createAutonomoMessageSegments(): MessageSegment[] {
    return [
        { id: 'autonomo-inicio', content: 'Perfeito! ✅ Vou te enviar o passo a passo completo.', type: 'text', delay: 1000 },
        { id: 'link-ecac', content: 'Acesse o e-CAC através deste **link oficial**: https://cav.receita.fazenda.gov.br/autenticacao/login', type: 'link', delay: 1500, metadata: { url: 'https://cav.receita.fazenda.gov.br/autenticacao/login', trackingKey: 'link-ecac' } },
        { id: 'video-tutorial', content: 'Aqui está um **vídeo tutorial** ensinando como criar a procuração no e-CAC:', type: 'text', delay: 2000 },
        { id: 'video-media', content: 'https://haylander.com.br/videos/procuracao-ecac-tutorial.mp4', type: 'media', delay: 2500, metadata: { mediaKey: 'video-tutorial-procuracao-ecac', trackingKey: 'video-tutorial', mediaType: 'video' } },
        { id: 'instrucoes-finais', content: 'Após criar a procuração, **volte aqui e me avise** que conseguiu! 🚀 Então enviarei o formulário para darmos continuidade.', type: 'text', delay: 3000 },
    ];
}

export function createAssistidoMessageSegments(): MessageSegment[] {
    return [
        { id: 'assistido-inicio', content: 'Ótima escolha! ⭐ Um de nossos **especialistas** irá auxiliá-lo durante todo o processo.', type: 'text', delay: 1000 },
        { id: 'preparacao-atendimento', content: 'Vou transferir você para o atendimento humano para te guiarmos passo a passo.', type: 'text', delay: 1500 },
        { id: 'aguarde-atendente', content: 'Por favor, **aguarde alguns instantes** enquanto preparamos seu atendimento...', type: 'text', delay: 2000 },
    ];
}
