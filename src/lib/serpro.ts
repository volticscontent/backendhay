import https from 'node:https';
import querystring from 'node:querystring';
import fs from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';
import { SERVICE_CONFIG } from './serpro-config';
import { SerproTokens, SerproPayload, SerproParte, SerproOptions, TipoContribuinte } from './serpro-types';
import { serproLogger } from './logger';

export { SERVICE_CONFIG };

const formatPem = (key: string | undefined) => {
    if (!key) return undefined;
    return key.replace(/\\n/g, '\n');
};

const getCertContent = (contentEnv: string | undefined, pathEnv: string | undefined): string | undefined => {
    if (contentEnv) return formatPem(contentEnv);
    if (pathEnv) {
        try {
            const certPath = path.resolve(process.cwd(), pathEnv);
            if (fs.existsSync(certPath)) {
                return fs.readFileSync(certPath, 'utf8');
            }
            serproLogger.warn(`Certificado não encontrado no caminho: ${certPath}`);
        } catch (error) {
            serproLogger.error(`Erro ao ler certificado do caminho ${pathEnv}:`, error);
        }
    }
    return undefined;
};

/**
 * Extrai certificado e chave privada de um buffer PFX usando node-forge (resiliente a formatos legados)
 */
const extractPfxData = (pfxBuffer: Buffer | undefined, passphrase?: string) => {
    if (!pfxBuffer) return { cert: undefined, key: undefined };
    try {
        const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase);

        // Extrair chave privada (pode estar em diferentes tipos de bags)
        let keyPem: string | undefined;
        const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
        if (keyBags && keyBags.length > 0 && keyBags[0].key) {
            keyPem = forge.pki.privateKeyToPem(keyBags[0].key);
        } else {
            const keyBagsAlt = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
            if (keyBagsAlt && keyBagsAlt.length > 0 && keyBagsAlt[0].key) {
                keyPem = forge.pki.privateKeyToPem(keyBagsAlt[0].key);
            }
        }

        // Extrair certificado
        let certPem: string | undefined;
        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
        if (certBags && certBags.length > 0 && certBags[0].cert) {
            certPem = forge.pki.certificateToPem(certBags[0].cert);
        }

        return { cert: certPem, key: keyPem };
    } catch (error) {
        serproLogger.error('Erro ao extrair dados do PFX com node-forge:', error);
        return { cert: undefined, key: undefined };
    }
};

const SERPRO_CLIENT_ID = process.env.SERPRO_CLIENT_ID;
const SERPRO_CLIENT_SECRET = process.env.SERPRO_CLIENT_SECRET;
const SERPRO_CERT_PASS = process.env.CERTIFICADO_SENHA;

const SERPRO_CERT_PEM_RAW = getCertContent(process.env.SERPRO_CERT_PEM, process.env.SERPRO_CERT_PEM_PATH);
const SERPRO_CERT_KEY_RAW = getCertContent(process.env.SERPRO_CERT_KEY, process.env.SERPRO_CERT_KEY_PATH);

const SERPRO_CERT_PFX_B64 = process.env.CERTIFICADO_BASE64 ? process.env.CERTIFICADO_BASE64.replace(/^"|"$/g, '').trim() : undefined;
const SERPRO_CERT_PFX_PATH = process.env.SERPRO_CERT_PFX_PATH;
const SERPRO_PFX_BUFFER = (SERPRO_CERT_PFX_PATH && fs.existsSync(SERPRO_CERT_PFX_PATH))
    ? fs.readFileSync(SERPRO_CERT_PFX_PATH)
    : (SERPRO_CERT_PFX_B64 ? Buffer.from(SERPRO_CERT_PFX_B64, 'base64') : undefined);

// Se tivermos PFX, extraímos os componentes para PEM para maior compatibilidade com Node.js https
const pfxExtracted = extractPfxData(SERPRO_PFX_BUFFER, SERPRO_CERT_PASS);

const FINAL_CERT = pfxExtracted.cert || SERPRO_CERT_PEM_RAW;
const FINAL_KEY = pfxExtracted.key || SERPRO_CERT_KEY_RAW;

/**
 * Lê a data de expiração (notAfter) do certificado mTLS atualmente carregado.
 * Usado pelo cron de alerta de vencimento — quando o cert vence, TODA chamada
 * Serpro falha no handshake TLS de uma vez. Retorna null se não houver cert ou falhar o parse.
 */
export function getCertNotAfter(): Date | null {
    if (!FINAL_CERT) return null;
    try {
        return forge.pki.certificateFromPem(FINAL_CERT).validity.notAfter;
    } catch (error) {
        serproLogger.error('Falha ao ler a validade do certificado Serpro:', error);
        return null;
    }
}

const SERPRO_ROLE_TYPE = process.env.SERPRO_ROLE_TYPE || 'TERCEIROS';
const SERPRO_AUTHENTICATE_URL = process.env.SERPRO_AUTHENTICATE_URL || 'https://autenticacao.sapi.serpro.gov.br/authenticate';

const INTEGRA_BASE_URLS = {
    Consultar: process.env.SERPRO_INTEGRA_CONSULTAR_URL || 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Consultar',
    Emitir: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Emitir',
    Solicitar: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Solicitar',
    Apoiar: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Apoiar',
};

const onlyDigits = (v: string) => v.replace(/\D/g, '');


const RETRY_SENTINEL = Symbol('retry');

export async function request(
    urlStr: string,
    options: https.RequestOptions,
    body?: string,
    retries: number = 2
): Promise<unknown> {
    const execute = (): Promise<unknown> => new Promise((resolve, reject) => {
        try {
            const url = new URL(urlStr);
            const reqOptions: https.RequestOptions = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: options.method || 'GET',
                headers: options.headers,
                ...(FINAL_CERT && FINAL_KEY
                    ? { cert: FINAL_CERT, key: FINAL_KEY, passphrase: SERPRO_CERT_PASS }
                    : {}
                ),
                timeout: 30000,
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode && (res.statusCode >= 200 && res.statusCode < 300 || res.statusCode === 304)) {
                        try { resolve(JSON.parse(data)); } catch { resolve(data || null); }
                    } else {
                        let errorMessage = `HTTP ${res.statusCode}`;
                        try {
                            const errObj = JSON.parse(data);
                            if (errObj.mensagens && Array.isArray(errObj.mensagens)) {
                                const msgs = errObj.mensagens.map((m: { codigo: string; texto: string }) => `[${m.codigo}] ${m.texto}`).join(' | ');
                                errorMessage += `: ${msgs}`;
                            } else if (errObj.error) {
                                errorMessage += `: ${errObj.error}`;
                            } else {
                                errorMessage += `: ${data.substring(0, 1000)}`;
                            }
                        } catch {
                            errorMessage += `: ${data.substring(0, 1000)}`;
                        }

                        // Retry on 500/502/503/504
                        if (retries > 0 && res.statusCode && res.statusCode >= 500) {
                            serproLogger.warn(`Retrying request to ${urlStr} due to ${res.statusCode}. Retries left: ${retries}. Error: ${errorMessage}`);
                            resolve(RETRY_SENTINEL);
                        } else {
                            reject(new Error(errorMessage));
                        }
                    }
                });
            });
            req.on('error', (e) => reject(e));
            req.on('timeout', () => {
                req.destroy(new Error(`Serpro timeout após 30s: ${urlStr}`));
            });
            if (body) req.write(body);
            req.end();
        } catch (e) {
            reject(e);
        }
    });

    for (let i = 0; i <= retries; i++) {
        const result = await execute();
        if (result !== RETRY_SENTINEL) return result;
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
    }
    throw new Error(`Max retries reached for ${urlStr}`);
}

let cachedTokens: SerproTokens | null = null;

/** Retorna o timestamp (ms) da próxima meia-noite no fuso de Brasília (UTC-3). */
function nextMidnightBRT(): number {
    const BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // BRT = UTC-3
    // Representa "agora" como se fosse UTC em BRT
    const nowAsBRT = new Date(Date.now() - BRT_OFFSET_MS);
    // Avança para meia-noite do próximo dia BRT
    nowAsBRT.setUTCHours(0, 0, 0, 0);
    nowAsBRT.setUTCDate(nowAsBRT.getUTCDate() + 1);
    // Devolve em UTC real
    return nowAsBRT.getTime() + BRT_OFFSET_MS;
}

export async function getSerproTokens(forceRefresh: boolean = false): Promise<SerproTokens> {
    const now = Date.now();
    if (cachedTokens && !forceRefresh && now < cachedTokens.expiresAt) return cachedTokens;

    if (!SERPRO_CLIENT_ID || !SERPRO_CLIENT_SECRET) {
        throw new Error('Credenciais do SERPRO ausentes (ID ou SECRET)');
    }
    if (!FINAL_CERT || !FINAL_KEY) {
        throw new Error('Certificado do SERPRO ausente');
    }

    const authHeader = 'Basic ' + Buffer.from(`${SERPRO_CLIENT_ID}:${SERPRO_CLIENT_SECRET}`).toString('base64');
    const postData = querystring.stringify({ grant_type: 'client_credentials' });

    const response = await request(SERPRO_AUTHENTICATE_URL, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Role-Type': SERPRO_ROLE_TYPE,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
        },
    }, postData);

    const raw = response as { access_token?: string; jwt_token?: string; expires_in?: number };
    if (raw.access_token && raw.jwt_token) {
        // Usa o expires_in REAL do Serpro (~1h) com margem de 60s, limitado à meia-noite BRT
        // (a Serpro também invalida o token na virada do dia). Antes assumíamos só nextMidnightBRT(),
        // o que mantinha o token "vivo" no cache por até 24h enquanto a Serpro já o havia expirado —
        // gerando 401 garantido na 1ª chamada após ~1h e thundering herd em consultas paralelas.
        const expiresIn = Number(raw.expires_in) || 3300;
        const byExpiresIn = Date.now() + Math.max(expiresIn - 60, 60) * 1000;
        cachedTokens = {
            access_token: raw.access_token,
            jwt_token: raw.jwt_token,
            expiresAt: Math.min(byExpiresIn, nextMidnightBRT()),
        };
        serproLogger.info(`Tokens Serpro renovados. Expiram em: ${new Date(cachedTokens.expiresAt).toISOString()}`);
        return cachedTokens;
    }
    throw new Error('Falha ao recuperar tokens do SERPRO');
}

export type { SerproOptions, SerproTokens, TipoContribuinte } from './serpro-types';

/**
 * Serviços de ESCRITA na Receita (alteram dados do contribuinte, não apenas consultam/emitem documento).
 * Exigem options.permitirEscrita === true para serem acionados. O atendimento automatizado (Apolo)
 * nunca envia essa flag, então fica bloqueado por padrão; apenas o painel admin (Haylander), após
 * confirmação explícita, a envia.
 */
const MUTATION_SERVICES = new Set<keyof typeof SERVICE_CONFIG>(['PGMEI_ATU_BENEFICIO']);

export async function consultarServico(nomeServico: keyof typeof SERVICE_CONFIG, cnpj: string, options: SerproOptions = {}) {
    const config = SERVICE_CONFIG[nomeServico];
    if (!config) throw new Error(`Serviço ${nomeServico} não configurado`);

    if (MUTATION_SERVICES.has(nomeServico) && options.permitirEscrita !== true) {
        throw new Error(`Operação de escrita "${nomeServico}" bloqueada: requer autorização explícita (permitirEscrita). Não disponível para atendimento automatizado.`);
    }

    const idSistema = process.env[config.env_sistema] || config.default_sistema;
    const idServico = process.env[config.env_servico] || config.default_servico;

    // Warn when PGFN_CONSULTAR or DIVIDA_ATIVA fall back to DIVIDAATIVA24 (env vars not configured)
    if (nomeServico === 'PGFN_CONSULTAR' || nomeServico === 'DIVIDA_ATIVA') {
        const missingEnvs = [config.env_sistema, config.env_servico].filter(k => !process.env[k]);
        if (missingEnvs.length > 0) {
            serproLogger.warn(`[${nomeServico}] Usando fallback DIVIDAATIVA24 — env vars não configuradas: ${missingEnvs.join(', ')}. Configure para usar endpoint dedicado quando disponível.`);
        }
    }

    if (!idSistema || !idServico) {
        const missing = [];
        if (!idSistema) missing.push(config.env_sistema);
        if (!idServico) missing.push(config.env_servico);
        throw new Error(`IDs não configurados para ${nomeServico}. Variáveis ausentes: ${missing.join(', ')}`);
    }

    const tokens = await getSerproTokens();
    const cnpjNumero = onlyDigits(cnpj);
    if (cnpjNumero.length !== 14) throw new Error('CNPJ inválido: envie 14 dígitos');

    // Inicialização base do objeto de dados - O CNPJ já vai no cabeçalho 'contribuinte' do Integra Contador
    // Muitos serviços (como PGMEI/DIVIDAATIVA24) dão erro 400 se o CNPJ for repetido no JSON 'dados'.
    const dadosServico: Record<string, unknown> = {};

    // SITFIS: SOLICITARPROTOCOLO91 exige dados="" (vazio). RELATORIOSITFIS92 exige {"protocoloRelatorio":"..."}
    // CAIXA_POSTAL: exige cnpjReferencia (tratado abaixo)

    // Tratamento de parâmetros temporais (Ano/Mês/PA)
    if (options.ano) {
        if (['PGMEI', 'DIVIDA_ATIVA', 'PGDASD', 'PGFN_CONSULTAR', 'PGMEI_EXTRATO', 'PGMEI_BOLETO', 'PGMEI_ATU_BENEFICIO'].includes(nomeServico)) {
            dadosServico.anoCalendario = options.ano;
        } else if (nomeServico === 'DCTFWEB') {
            dadosServico.anoPA = options.ano;
        } else {
            dadosServico.ano = options.ano;
        }
    } else if (['PGMEI', 'DIVIDA_ATIVA', 'PGDASD', 'PGFN_CONSULTAR', 'DCTFWEB', 'PGMEI_EXTRATO', 'PGMEI_BOLETO', 'PGMEI_ATU_BENEFICIO'].includes(nomeServico)) {
        const currentYear = new Date().getFullYear().toString();
        if (nomeServico === 'DCTFWEB') dadosServico.anoPA = currentYear;
        else dadosServico.anoCalendario = currentYear;
    }

    if (options.mes) {
        const mesPad = options.mes.padStart(2, '0');
        const anoParaMes = options.ano || new Date().getFullYear().toString();
        if (nomeServico === 'DCTFWEB') {
            dadosServico.mesPA = (options.mes || String(new Date().getMonth() + 1)).padStart(2, '0');
        } else if (['PGMEI_EXTRATO', 'PGMEI_BOLETO'].includes(nomeServico)) {
            // Serpro exige formato YYYYMM
            dadosServico.periodoApuracao = `${anoParaMes}${mesPad}`;
        }
    }

    // Exceções e Campos Específicos por Serviço
    if (nomeServico === 'DCTFWEB') {
        dadosServico.categoria = options.categoria || 'GERAL_MENSAL';
        if (dadosServico.categoria === 'GERAL_MENSAL' || dadosServico.categoria === 'ESPETACULO_DESPORTIVO') {
            dadosServico.mesPA = (options.mes || String(new Date().getMonth() + 1)).padStart(2, '0');
        } else {
            delete dadosServico.mesPA;
            delete dadosServico.mes;
        }
    }

    // PGMEI_ATU_BENEFICIO (ATUBENEFICIO23): payload exige anoCalendario (número) + infoBeneficio (lista de meses).
    if (nomeServico === 'PGMEI_ATU_BENEFICIO') {
        const info = options.infoBeneficio;
        if (!Array.isArray(info) || info.length === 0) {
            throw new Error('HTTP 400: PGMEI_ATU_BENEFICIO requer infoBeneficio — lista de { periodoApuracao: "AAAAMM", indicadorBeneficio: boolean }.');
        }
        for (const item of info) {
            if (!/^\d{6}$/.test(String(item?.periodoApuracao ?? '')) || typeof item?.indicadorBeneficio !== 'boolean') {
                throw new Error('HTTP 400: infoBeneficio inválido — cada item precisa de periodoApuracao "AAAAMM" e indicadorBeneficio boolean.');
            }
        }
        dadosServico.anoCalendario = Number(options.ano) || new Date().getFullYear();
        delete dadosServico.mes;
        dadosServico.infoBeneficio = info;
    }

    if (nomeServico === 'CAIXA_POSTAL') {
        delete dadosServico.cnpj;
        delete dadosServico.ano;
        delete dadosServico.mes;
        dadosServico.cnpjReferencia = cnpjNumero;
        // Serpro exige 1 dígito: 0=Todas, 1=Lidas, 2=Não Lidas. (Letras como 'T' são rejeitadas com HTTP 400.)
        const LEITURA_LEGADO: Record<string, string> = { T: '0', L: '1', N: '2' };
        const leituraRaw = options.statusLeitura ? String(options.statusLeitura).trim().toUpperCase() : '0';
        const leitura = LEITURA_LEGADO[leituraRaw] ?? leituraRaw;
        dadosServico.statusLeitura = /^[0-2]$/.test(leitura) ? leitura : '0';
        dadosServico.indicadorPagina = options.indicadorPagina || '1';
    }

    if (options.numeroDas) {
        dadosServico.numeroDas = options.numeroDas; // Obrigatório para PGDASD CONSEXTRATO16
    }

    if (options.numeroRecibo) dadosServico.numeroRecibo = options.numeroRecibo;
    if (options.codigoReceita) dadosServico.codigoReceita = options.codigoReceita;

    // Parcela para emissão — formato YYYYMM obrigatório (ex: "202601")
    if (['PARCELAMENTO_SN_EMITIR', 'PARCELAMENTO_MEI_EMITIR'].includes(nomeServico)) {
        if (options.parcelaParaEmitir) {
            dadosServico.parcelaParaEmitir = options.parcelaParaEmitir;
        } else if (options.mes && options.ano) {
            dadosServico.parcelaParaEmitir = `${options.ano}${options.mes.padStart(2, '0')}`;
        } else {
            const now = new Date();
            dadosServico.parcelaParaEmitir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
    }

    if (nomeServico === 'PGDASD' && !options.numeroDas) {
        throw new Error('HTTP 400: Parâmetros de entrada inválidos. Número do DAS é obrigatório para Extrato PGDASD.');
    }

    if (['PGMEI_EXTRATO', 'PGMEI_BOLETO'].includes(nomeServico) && !options.mes) {
        throw new Error(`HTTP 400: Parâmetros de entrada inválidos. O mês (período de apuração) é obrigatório para ${nomeServico}.`);
    }

    if (nomeServico === 'PAGAMENTO' && !options.numeroDas && !options.numeroRecibo) {
        throw new Error('HTTP 400: Parâmetros de entrada inválidos. Informe número do documento de arrecadação.');
    }

    const contratanteCnpj = onlyDigits(process.env.CONTRATANTE_CNPJ || process.env.SERPRO_CNPJ_BASE || '51564549000140');
    const isParcelamentoConsulta = ['PARCELAMENTO_SN_CONSULTAR', 'PARCELAMENTO_MEI_CONSULTAR'].includes(nomeServico);

    // Serviços que usam CPF do empresário como contribuinte
    const isSitfis = ['SIT_FISCAL_SOLICITAR', 'SIT_FISCAL_RELATORIO', 'CND'].includes(nomeServico);
    const isProcuracao = nomeServico === 'PROCURACAO';
    const cpfNumero = options.cpf ? onlyDigits(options.cpf) : undefined;
    if (isSitfis && !cpfNumero) throw new Error(`${nomeServico} requer options.cpf (CPF do empresário — SITFIS é CPF-based, não aceita CNPJ como contribuinte)`);
    const contribuinteNumero = ((isSitfis || isProcuracao) && cpfNumero) ? cpfNumero : cnpjNumero;
    const contribuinteTipo = ((isSitfis || isProcuracao) && cpfNumero && cpfNumero.length === 11)
        ? TipoContribuinte.CPF
        : TipoContribuinte.CNPJ;

    // Montar campo 'dados' por tipo de serviço
    let dadosField: string;
    if (nomeServico === 'SIT_FISCAL_SOLICITAR') {
        dadosField = '';
    } else if (nomeServico === 'SIT_FISCAL_RELATORIO' || nomeServico === 'CND') {
        if (!options.protocoloRelatorio) throw new Error(`${nomeServico} requer options.protocoloRelatorio — fluxo obrigatório 2 etapas: 1) SIT_FISCAL_SOLICITAR → obtém protocolo, 2) ${nomeServico} com o protocolo retornado`);
        dadosField = JSON.stringify({ protocoloRelatorio: options.protocoloRelatorio });
    } else if (isProcuracao) {
        // OBTERPROCURACAO41: outorgante = CNPJ da empresa cliente, outorgado = CNPJ do contador
        dadosField = JSON.stringify({
            outorgante: cnpjNumero,
            tipoOutorgante: '2',
            outorgado: contratanteCnpj,
            tipoOutorgado: '2',
        });
    } else if (isParcelamentoConsulta) {
        dadosField = '';
    } else {
        dadosField = JSON.stringify(dadosServico);
    }

    const contratante: SerproParte = { numero: contratanteCnpj, tipo: TipoContribuinte.CNPJ };
    const payload: SerproPayload = {
        contratante,
        autorPedidoDados: contratante,
        contribuinte: { numero: contribuinteNumero, tipo: contribuinteTipo },
        pedidoDados: {
            idSistema,
            idServico,
            versaoSistema: config.versaoSistema || '1.0',
            dados: dadosField,
        },
    };

    const serviceType = config.tipo as keyof typeof INTEGRA_BASE_URLS;
    const baseUrl = INTEGRA_BASE_URLS[serviceType] || INTEGRA_BASE_URLS['Consultar'];

    const payloadStr = JSON.stringify(payload);
    serproLogger.info(`Consultando ${nomeServico} para CNPJ ${cnpjNumero}`, { idSistema, idServico, payload: payloadStr });

    const firstAttempt = async () => {
        return request(baseUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'jwt_token': tokens.jwt_token,
                'Content-Type': 'application/json',
            },
        }, JSON.stringify(payload));
    };

    try {
        return await firstAttempt();
    } catch (error: any) {
        if (error.message && error.message.includes('HTTP 401')) {
            serproLogger.warn('Token expirado (401). Recarregando tokens e tentando novamente...');
            const newTokens = await getSerproTokens(true);
            return await request(baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${newTokens.access_token}`,
                    'jwt_token': newTokens.jwt_token,
                    'Content-Type': 'application/json',
                },
            }, JSON.stringify(payload));
        }
        throw error;
    }
}
