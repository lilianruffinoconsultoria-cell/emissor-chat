// Adaptador do ADN (Sefin Nacional da NFS-e): unico ponto do modulo que fala com o web service.
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import {
  gerarIdDps,
  getAdnBaseUrl,
  gunzipBase64,
  NFSeCore,
  NFSeRejectError,
  type CertificateData,
  type NFSeBinaryResponse,
  type NFSeHttpResponse,
  type NFSeTransport
} from '@brasil-fiscal/nfse';
import { CertificadoA1 } from '../../../comum/certificado.ts';
import { config } from '../../../config.ts';
import type { DpsMontada } from '../motor.ts';
import { regrasNfseVigentes } from '../regras.ts';
import { XmlDps } from './xml.ts';

export const BASE_ADN = getAdnBaseUrl(config.ambiente);

export type ErroAdn = { codigo?: string; descricao?: string; complemento?: string };

export type ResultadoNfse = {
  status: 'autorizada' | 'rejeitada' | 'pendente' | 'erro';
  chave?: string;
  codigo?: string;
  motivo?: string;
  erros?: ErroAdn[];
  xmlDps?: string;
  xmlNfse?: string;
};

/** Erro de rede que aconteceu antes do pedido sair: reenviar e seguro. */
class FalhaAntesDoEnvio extends Error {}

/** HTTPS com o certificado A1 e tempo limite; o transporte da biblioteca nao tem limite de tempo. */
class TransporteHttps implements NFSeTransport {
  constructor(private readonly limiteMs: number) {}

  async postJson(url: string, body: unknown, cert: CertificateData): Promise<NFSeHttpResponse> {
    const r = await this.enviar('POST', url, cert, Buffer.from(JSON.stringify(body), 'utf-8'));
    return { statusCode: r.statusCode, body: r.body.toString('utf-8') };
  }

  async get(url: string, cert: CertificateData): Promise<NFSeHttpResponse> {
    const r = await this.enviar('GET', url, cert);
    return { statusCode: r.statusCode, body: r.body.toString('utf-8') };
  }

  getBinary(url: string, cert: CertificateData): Promise<NFSeBinaryResponse> {
    return this.enviar('GET', url, cert);
  }

  private enviar(method: 'GET' | 'POST', url: string, cert: CertificateData, corpo?: Buffer): Promise<NFSeBinaryResponse> {
    const u = new URL(url);
    return new Promise((resolve, reject) => {
      let saiu = false;
      const req = request(
        {
          method,
          hostname: u.hostname,
          path: `${u.pathname}${u.search}`,
          pfx: cert.pfx,
          passphrase: cert.password,
          headers: {
            Accept: 'application/json',
            ...(corpo ? { 'Content-Type': 'application/json', 'Content-Length': corpo.length } : {})
          },
          timeout: this.limiteMs
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on('data', (c: Buffer) => partes.push(c));
          res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(partes) }));
          res.on('error', reject);
        }
      );
      req.on('finish', () => (saiu = true));
      req.on('timeout', () => req.destroy(new Error(`Sem resposta do ADN em ${this.limiteMs / 1000} s`)));
      req.on('error', (e) => reject(saiu ? e : new FalhaAntesDoEnvio(e.message)));
      req.end(corpo);
    });
  }
}

/** Guarda o que foi enviado e recebido: a DPS assinada precisa existir mesmo sem resposta. */
class TransporteComCaptura implements NFSeTransport {
  requisicao?: { dpsXmlGZipB64?: string };
  resposta?: NFSeHttpResponse;
  constructor(private readonly base: NFSeTransport) {}
  async postJson(url: string, body: unknown, cert: CertificateData) {
    this.requisicao = body as { dpsXmlGZipB64?: string };
    this.resposta = await this.base.postJson(url, body, cert);
    return this.resposta;
  }
  get(url: string, cert: CertificateData) {
    return this.base.get(url, cert);
  }
  getBinary(url: string, cert: CertificateData) {
    return this.base.getBinary(url, cert);
  }
  get dpsEnviada(): string | undefined {
    try {
      return this.requisicao?.dpsXmlGZipB64 ? gunzipBase64(this.requisicao.dpsXmlGZipB64) : undefined;
    } catch {
      return undefined;
    }
  }
}

let transporteBase: NFSeTransport = new TransporteHttps(45000);

/** Usado somente pelos testes automatizados para simular o ADN. */
export function definirTransporte(t: NFSeTransport): void {
  transporteBase = t;
}

let certificado: { arquivo: string; provedor: CertificadoA1 } | undefined;

function provedorCertificado(): CertificadoA1 {
  if (!config.pfxPath) throw new Error('Certificado nao configurado: rode npm run sefaz:check para criar o .env.');
  if (certificado?.arquivo !== config.pfxPath) {
    certificado = { arquivo: config.pfxPath, provedor: new CertificadoA1(readFileSync(config.pfxPath), config.pfxSenha) };
  }
  return certificado.provedor;
}

function core(transport: NFSeTransport, codigoMunicipio = ''): NFSeCore {
  const certificate = provedorCertificado();
  return NFSeCore.create({
    pfx: Buffer.alloc(0), // nao usado: o certificado vem do provedor acima
    senha: '',
    certificate,
    ambiente: config.ambiente,
    codigoMunicipio,
    xmlBuilder: new XmlDps(regrasNfseVigentes()),
    transport
  });
}

export const idDps = (dps: DpsMontada) =>
  gerarIdDps({
    codigoMunicipio: dps.codigoMunicipioEmissor ?? '',
    tipoInscricao: dps.prestador.cnpj ? 2 : 1,
    documento: dps.prestador.cnpj ?? dps.prestador.cpf ?? '',
    serie: dps.serie,
    numeroDps: dps.numero
  });

const erroLegivel = (corpo: string) => corpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

/**
 * Erros do corpo da resposta. O swagger da Sefin (NFSePostResponseErro / ResponseErro) usa
 * erros[] ou erro, com campos em minusculas; a biblioteca so le Codigo/Descricao e os perde.
 */
export function errosDaResposta(corpo?: string): ErroAdn[] {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(corpo ?? '') as Record<string, unknown>;
  } catch {
    return [];
  }
  const lista = Array.isArray(r.erros) ? r.erros : r.erro ? [r.erro] : [];
  return (lista as Record<string, unknown>[]).map((e) => ({
    codigo: (e.codigo ?? e.Codigo) as string | undefined,
    descricao: (e.descricao ?? e.Descricao) as string | undefined,
    complemento: ((e.complemento ?? e.Complemento) as string | null | undefined) ?? undefined
  }));
}

export async function emitirNfse(dps: DpsMontada): Promise<ResultadoNfse> {
  const transporte = new TransporteComCaptura(transporteBase);
  try {
    const r = await core(transporte, dps.codigoMunicipioEmissor).emitir(dps);
    return { status: 'autorizada', chave: r.chaveAcesso, codigo: String(r.statusHttp), xmlDps: r.xmlDps, xmlNfse: r.xmlNfse };
  } catch (e) {
    const xmlDps = transporte.dpsEnviada;
    if (e instanceof NFSeRejectError) {
      // 5xx: o ADN pode ter gerado a nota mesmo assim. Fica pendente e a consulta pelo Id da DPS decide.
      if (e.statusCode >= 500) {
        return { status: 'pendente', codigo: String(e.statusCode), motivo: `ADN respondeu HTTP ${e.statusCode}`, xmlDps };
      }
      const erros = errosDaResposta(transporte.resposta?.body);
      const primeiro = erros[0];
      return {
        status: 'rejeitada',
        codigo: primeiro?.codigo ?? `HTTP ${e.statusCode}`,
        motivo: primeiro?.descricao ?? (erroLegivel(transporte.resposta?.body ?? '') || e.message),
        erros,
        xmlDps
      };
    }
    const motivo = (e as Error).message.slice(0, 300);
    // Saiu sem resposta conclusiva: pode ter sido gerada, nao pode ser reenviada as cegas.
    const enviado = Boolean(transporte.requisicao) && !(e instanceof FalhaAntesDoEnvio) && !transporte.resposta;
    return { status: enviado ? 'pendente' : 'erro', motivo, xmlDps };
  }
}

/** Para nota pendente: pergunta ao ADN se a DPS virou NFS-e e, se virou, baixa o XML. */
export async function consultarPorDps(id: string): Promise<{ gerada: boolean; chave?: string; xmlNfse?: string }> {
  const c = core(transporteBase);
  const r = await c.consultarPorDps(id);
  if (!r.encontrada || !r.chaveAcesso) return { gerada: false };
  const n = await c.consultar(r.chaveAcesso);
  return { gerada: true, chave: r.chaveAcesso, xmlNfse: n.xmlNfse || undefined };
}

export class CancelamentoRecusado extends Error {
  constructor(readonly erros: ErroAdn[], mensagem: string) {
    super(mensagem);
  }
}

export async function cancelarNfse(chave: string, cnpj: string, motivo: string): Promise<{ registrado: boolean; xmlEvento: string }> {
  const transporte = new TransporteComCaptura(transporteBase);
  try {
    const r = await core(transporte).cancelar({ chaveAcesso: chave, cMotivo: 1, xMotivo: motivo, autorCnpj: cnpj });
    return { registrado: r.registrado, xmlEvento: r.xmlEvento };
  } catch (e) {
    if (e instanceof NFSeRejectError) {
      const corpo = transporte.resposta?.body ?? '';
      throw new CancelamentoRecusado(errosDaResposta(corpo), erroLegivel(corpo) || e.message);
    }
    throw e;
  }
}

// DANFSe: a API do ADN foi suspensa em 03/08/2026 (NT 008 v1.02) e a Sefin responde 501 em /DANFSe.
// O PDF e gerado pelo proprio emissor, em ../danfse.ts.

// Os parametros municipais ficam no ADN, nao na Sefin: swagger em /parametrizacao/swagger/v1/swagger.json.
export const BASE_PARAMETROS = config.ambiente === 'homologacao'
  ? 'https://adn.producaorestrita.nfse.gov.br/parametrizacao'
  : 'https://adn.nfse.gov.br/parametrizacao';

export type Convenio = {
  statusHttp: number;
  ms: number;
  mensagem?: string;
  parametros: Record<string, unknown> | null; // aderenteAmbienteNacional, aderenteEmissorNacional...
};

/** Convenio do municipio no Sistema Nacional. 404 com mensagem = convenio inexistente ou inativo. */
export async function convenioMunicipio(codigoMunicipio: string): Promise<Convenio> {
  const inicio = Date.now();
  const cert = await provedorCertificado().load();
  const r = await transporteBase.get(`${BASE_PARAMETROS}/${codigoMunicipio}/convenio`, cert);
  let corpo: { parametrosConvenio?: Record<string, unknown> | null; mensagem?: string } = {};
  try {
    corpo = JSON.parse(r.body);
  } catch {
    // corpo nao-JSON
  }
  return { statusHttp: r.statusCode, ms: Date.now() - inicio, mensagem: corpo.mensagem, parametros: corpo.parametrosConvenio ?? null };
}
