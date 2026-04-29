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
        { id: 'autonomo-inicio', content: 'Perfeito! ✅ Preparei tudo para você. Primeiro, assista a este vídeo de menos de 2 minutos — ele mostra exatamente o que fazer:', type: 'text', delay: 1000 },
        { id: 'video-tutorial', content: 'https://www.instagram.com/reel/DWquc43Cdnm/?igsh=OXlzc2ZzNDVvaHU5', type: 'link', delay: 1500, metadata: { url: 'https://www.instagram.com/reel/DWquc43Cdnm/?igsh=OXlzc2ZzNDVvaHU5', trackingKey: 'video-tutorial' } },
        { id: 'passo-a-passo', content: `*✅ Como criar a Procuração no e-CAC — Passo a Passo*

*1. Acesse o Portal de Autorizações*
🔗 https://servicos.receitafederal.gov.br/servico/autorizacoes/minhas-autorizacoes
🔐 Faça login com sua conta Gov.br nível Prata ou Ouro
✅ Selecione seu nome no canto superior direito
⌨️ Digite seu CNPJ no primeiro campo, selecione o perfil "Representante no CNPJ" e clique em *Representar*

*2. Clique em "Nova Autorização"*

*3. Preencha os dados:*
Meu CNPJ: *51.564.549/0001-40*
Validade: escolha o prazo mínimo de 5 dias

*4. Serviços*
✅ Selecione *Todos* e clique em Avançar

*5. Assine digitalmente*
📲 O sistema enviará um código de 6 dígitos no app Gov.br
🔑 Insira o código no site para concluir

✅ A procuração é ativada na hora ou em até 24 horas.`, type: 'text', delay: 2500 },
        { id: 'instrucoes-finais', content: 'Após criar a procuração, *me avise aqui* que concluiu! 🚀 Vou confirmar a autorização e em seguida faço a consulta completa das pendências do seu CNPJ.', type: 'text', delay: 3500 },
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
