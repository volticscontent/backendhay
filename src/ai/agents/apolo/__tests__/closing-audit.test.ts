import { auditarCadastroCompleto } from '../closing-audit';

const leadCompleto = {
    nome_completo: 'Maria Souza',
    cnpj: '12.345.678/0001-90',
    cpf: '123.456.789-00',
    email: 'maria@exemplo.com',
};

describe('auditarCadastroCompleto', () => {
    it('aprova quando todos os campos obrigatórios estão presentes (Opção A)', () => {
        const r = auditarCadastroCompleto(leadCompleto, false);
        expect(r.completo).toBe(true);
        expect(r.faltando).toHaveLength(0);
    });

    it('aceita razao_social no lugar de nome_completo', () => {
        const { nome_completo, ...semNome } = leadCompleto;
        const r = auditarCadastroCompleto({ ...semNome, razao_social: 'ACME ME' }, false);
        expect(r.completo).toBe(true);
    });

    it('aponta o CPF faltante (cenário do bug do <user_data> cego para cpf)', () => {
        const { cpf, ...semCpf } = leadCompleto;
        const r = auditarCadastroCompleto(semCpf, false);
        expect(r.completo).toBe(false);
        expect(r.faltando).toContain('CPF');
    });

    it('aponta o E-mail faltante', () => {
        const { email, ...semEmail } = leadCompleto;
        const r = auditarCadastroCompleto(semEmail, false);
        expect(r.completo).toBe(false);
        expect(r.faltando).toContain('E-mail (email)');
    });

    it('exige Senha GOV apenas na Opção B', () => {
        // Opção A: senha_gov não é exigida
        expect(auditarCadastroCompleto(leadCompleto, false).completo).toBe(true);
        // Opção B sem senha_gov: incompleto
        const semSenha = auditarCadastroCompleto(leadCompleto, true);
        expect(semSenha.completo).toBe(false);
        expect(semSenha.faltando).toContain('Senha GOV (senha_gov)');
        // Opção B com senha_gov: completo
        const comSenha = auditarCadastroCompleto({ ...leadCompleto, senha_gov_enc: 'enc...' }, true);
        expect(comSenha.completo).toBe(true);
    });

    it('trata strings vazias e espaços como ausência', () => {
        const r = auditarCadastroCompleto({ ...leadCompleto, cpf: '   ', email: '' }, false);
        expect(r.completo).toBe(false);
        expect(r.faltando).toEqual(expect.arrayContaining(['CPF', 'E-mail (email)']));
    });

    it('lista todos os campos faltantes de um lead vazio', () => {
        const r = auditarCadastroCompleto({}, true);
        expect(r.completo).toBe(false);
        expect(r.faltando).toEqual([
            'Nome/Razão Social (nome_completo)',
            'CNPJ',
            'CPF',
            'E-mail (email)',
            'Senha GOV (senha_gov)',
        ]);
    });
});
