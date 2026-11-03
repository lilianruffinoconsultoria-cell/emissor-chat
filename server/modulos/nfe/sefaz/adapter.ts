// Adaptador SEFAZ: unico ponto do sistema que fala com os web services.
import { readFileSync } from 'node:fs';
import {
  DefaultXmlBuilder,
  NFeCore,
  NodeHttpSefazTransport,
  SefazRejectError,
  type NFeProps,
  type SefazRequest,
  type SefazResponse,
  type SefazTransport
} from '@brasil-fiscal/nfe';
import { config } from '../../../config.ts';
import { CertificadoA1 } from '../../../comum/certificado.ts';
import { gerarDanfe } from '../danfe/gerador.ts';
import { ajustarXml, type Crt } from './xml.ts';

const NS = 'http://www.portalfiscal.inf.br/nfe';
const HOST_SP = 'https://homologacao.nfe.fazenda.sp.gov.br/ws';

export type ResultadoEmissao = {
  status: 'autorizada' | 'rejeitada' | 'pendente' | 'erro';
  chave?: string;
  protocolo?: string;
  cStat?: string;
  xMotivo?: string;
  xmlEnviado?: string;
  xmlProtocolado?: string;
};

/** Guarda o que foi enviado: o XML assinado precisa existir mesmo se a resposta nunca chegar. */
class TransporteComCaptura implements SefazTransport {
  requisicao?: string;
  resposta?: string;
  constructor(private readonly base: SefazTransport) {}
  async send(req: SefazRequest): Promise<SefazResponse> {
    this.requisicao = req.xml;
    const res = await this.base.send(req);
    this.resposta = res.xml;
    return res;
  }
}

let transporteBase: SefazTransport = new NodeHttpSefazTransport({ timeout: 45000 });

/** Usado somente pelos testes automatizados para simular respostas da SEFAZ. */
export function definirTransporte(t: SefazTransport): void {
  transporteBase = t;
}

function pfx(): Buffer {
  if (!config.pfxPath) throw new Error('Certificado nao configurado: rode npm run sefaz:check para criar o .env.');
  return readFileSync(config.pfxPath);
}

/** Aplica os ajustes antes da assinatura, para ela cobrir o conteudo final. */
class XmlComCrt extends DefaultXmlBuilder {
  constructor(private readonly crt: Crt) {
    super();
  }
  override build(nfe: NFeProps): string {
    return ajustarXml(super.build(nfe), this.crt);
  }
}

function core(transport: SefazTransport, crt: Crt = 1): NFeCore {
  const arquivo = pfx();
  return NFeCore.create({
    pfx: arquivo,
    senha: config.pfxSenha,
    certificate: new CertificadoA1(arquivo, config.pfxSenha),
    xmlBuilder: new XmlComCrt(crt),
    ambiente: config.ambiente,
    uf: config.uf,
    transport
  });
}

const tag = (xml: string, nome: string) =>
  xml.match(new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([^<]*)<`))?.[1].replace(/&amp;/g, '&');

function extrairEnvio(envelope?: string): { chave?: string; xml?: string } {
  if (!envelope) return {};
  const nfe = envelope.match(/<NFe[\s>][\s\S]*<\/NFe>/)?.[0];
  return { chave: envelope.match(/Id="NFe(\d{44})"/)?.[1], xml: nfe };
}

export async function emitir(nfe: NFeProps, crt: Crt = 1): Promise<ResultadoEmissao> {
  const transporte = new TransporteComCaptura(transporteBase);
  try {
    const r = await core(transporte, crt).transmitir(nfe);
    const envio = extrairEnvio(transporte.requisicao);
    return {
      status: 'autorizada',
      chave: r.chaveAcesso || envio.chave,
      protocolo: r.protocolo,
      cStat: r.codigoStatus,
      xMotivo: r.motivo,
      xmlEnviado: envio.xml,
      xmlProtocolado: r.xmlProtocolado
    };
  } catch (e) {
    const envio = extrairEnvio(transporte.requisicao);
    if (e instanceof SefazRejectError) {
      return { status: 'rejeitada', chave: envio.chave, cStat: e.cStat, xMotivo: e.xMotivo, xmlEnviado: envio.xml };
    }
    // Resposta recebida sem protocolo: rejeicao no nivel do lote.
    const cStat = transporte.resposta && tag(transporte.resposta, 'cStat');
    if (cStat) {
      return {
        status: 'rejeitada',
        chave: envio.chave,
        cStat,
        xMotivo: tag(transporte.resposta!, 'xMotivo'),
        xmlEnviado: envio.xml
      };
    }
    // Enviado sem resposta conclusiva: a nota pode ter sido autorizada, nao pode ser reenviada as cegas.
    const enviado = Boolean(transporte.requisicao) && !transporte.resposta;
    return {
      status: enviado ? 'pendente' : 'erro',
      chave: envio.chave,
      xMotivo: (e as Error).message.slice(0, 300),
      xmlEnviado: envio.xml
    };
  }
}

export async function consultar(chave: string) {
  return core(transporteBase).consultarProtocolo(chave);
}

export async function danfe(xmlProtocolado: string): Promise<Buffer> {
  return gerarDanfe(xmlProtocolado);
}

function envelope(wsdl: string, corpo: string): string {
  return (
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeDadosMsg xmlns="${NS}/wsdl/${wsdl}">${corpo}</nfeDadosMsg></soap:Body></soap:Envelope>`
  );
}

export async function statusServico(): Promise<{ cStat?: string; xMotivo?: string; ms: number }> {
  const inicio = Date.now();
  const res = await transporteBase.send({
    url: `${HOST_SP}/nfestatusservico4.asmx`,
    soapAction: `${NS}/wsdl/NFeStatusServico4/nfeStatusServicoNF`,
    xml: envelope(
      'NFeStatusServico4',
      `<consStatServ versao="4.00" xmlns="${NS}"><tpAmb>2</tpAmb><cUF>35</cUF><xServ>STATUS</xServ></consStatServ>`
    ),
    pfx: pfx(),
    password: config.pfxSenha
  });
  return { cStat: tag(res.xml, 'cStat'), xMotivo: tag(res.xml, 'xMotivo'), ms: Date.now() - inicio };
}

export type EnderecoCadastro = { logradouro?: string; numero?: string; bairro?: string; municipio?: string; cep?: string };

export async function consultarCadastro(cnpj: string): Promise<{ cStat?: string; xMotivo?: string; ie?: string; cSit?: string; indCredNFe?: string; regime?: string; endereco?: EnderecoCadastro }> {
  const res = await transporteBase.send({
    url: `${HOST_SP}/cadconsultacadastro4.asmx`,
    soapAction: `${NS}/wsdl/CadConsultaCadastro4/consultaCadastro`,
    xml: envelope(
      'CadConsultaCadastro4',
      `<ConsCad versao="2.00" xmlns="${NS}"><infCons><xServ>CONS-CAD</xServ><UF>${config.uf}</UF><CNPJ>${cnpj}</CNPJ></infCons></ConsCad>`
    ),
    pfx: pfx(),
    password: config.pfxSenha
  });
  return {
    cStat: tag(res.xml, 'cStat'),
    xMotivo: tag(res.xml, 'xMotivo'),
    ie: tag(res.xml, 'IE'),
    cSit: tag(res.xml, 'cSit'),
    indCredNFe: tag(res.xml, 'indCredNFe'),
    regime: tag(res.xml, 'xRegApur'),
    endereco: {
      logradouro: tag(res.xml, 'xLgr'),
      numero: tag(res.xml, 'nro'),
      bairro: tag(res.xml, 'xBairro'),
      municipio: tag(res.xml, 'xMun'),
      cep: tag(res.xml, 'CEP')
    }
  };
}
