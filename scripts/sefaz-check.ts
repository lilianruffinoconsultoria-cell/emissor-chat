// Consultas somente leitura na SEFAZ: status do servico e cadastro do emitente.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeHttpSefazTransport } from '@brasil-fiscal/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

if (!existsSync(envPath)) {
  const parent = resolve(root, '..');
  const pfx = readdirSync(parent).find((f) => f.toLowerCase().endsWith('.pfx'));
  const senha = pfx?.match(/senha\s+(\S+?)\.pfx$/i)?.[1];
  if (!pfx || !senha) throw new Error('Certificado .pfx nao encontrado na pasta do projeto.');
  writeFileSync(envPath, `PFX_PATH=${join(parent, pfx)}\nPFX_SENHA=${senha}\nAMBIENTE=homologacao\nUF=SP\n`);
  console.log('.env criado');
}
process.loadEnvFile(envPath);

const pfx = readFileSync(process.env.PFX_PATH!);
const password = process.env.PFX_SENHA!;
const cnpj = process.argv[2] ?? '61587327000104';
const NS = 'http://www.portalfiscal.inf.br/nfe';
const HOST = 'https://homologacao.nfe.fazenda.sp.gov.br/ws';
const transport = new NodeHttpSefazTransport({ timeout: 30000 });

const envelope = (wsdl: string, inner: string) =>
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
  `<nfeDadosMsg xmlns="${NS}/wsdl/${wsdl}">${inner}</nfeDadosMsg></soap:Body></soap:Envelope>`;

const pick = (xml: string, tag: string) => xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([^<]*)<`))?.[1];

async function call(name: string, url: string, action: string, xml: string) {
  const started = Date.now();
  try {
    const res = await transport.send({ url, soapAction: action, xml, pfx, password });
    console.log(`\n[${name}] HTTP ${res.statusCode} em ${Date.now() - started}ms`);
    return res.xml;
  } catch (e) {
    console.log(`\n[${name}] FALHOU: ${(e as Error).message.slice(0, 400)}`);
    return null;
  }
}

const status = await call(
  'status',
  `${HOST}/nfestatusservico4.asmx`,
  `${NS}/wsdl/NFeStatusServico4/nfeStatusServicoNF`,
  envelope('NFeStatusServico4', `<consStatServ versao="4.00" xmlns="${NS}"><tpAmb>2</tpAmb><cUF>35</cUF><xServ>STATUS</xServ></consStatServ>`)
);
if (status) console.log('cStat', pick(status, 'cStat'), '-', pick(status, 'xMotivo'), '| tpAmb', pick(status, 'tpAmb'), '| verAplic', pick(status, 'verAplic'));

const cad = await call(
  'cadastro',
  `${HOST}/cadconsultacadastro4.asmx`,
  `${NS}/wsdl/CadConsultaCadastro4/consultaCadastro`,
  envelope('CadConsultaCadastro4', `<ConsCad versao="2.00" xmlns="${NS}"><infCons><xServ>CONS-CAD</xServ><UF>SP</UF><CNPJ>${cnpj}</CNPJ></infCons></ConsCad>`)
);
if (cad) {
  console.log('cStat', pick(cad, 'cStat'), '-', pick(cad, 'xMotivo'));
  for (const t of ['IE', 'CNPJ', 'xNome', 'xRegApur', 'cSit', 'indCredNFe', 'indCredCTe', 'CNAE', 'dIniAtiv', 'xMun']) {
    const v = pick(cad, t);
    if (v !== undefined) console.log(' ', t, '=', v);
  }
}
