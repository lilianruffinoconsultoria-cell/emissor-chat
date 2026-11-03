// Modulo NFS-e com o ADN SIMULADO. Nada aqui comprova autorizacao real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import forge from 'node-forge';

const dir = mkdtempSync(join(tmpdir(), 'emissor-nfse-'));
process.env.EMISSOR_DB = join(dir, 'teste.db');
process.env.EMISSOR_DATA_DIR = dir;
process.env.EMITENTE_CNPJ = '61587327000104';

// Certificado descartavel gerado na hora: os testes nunca tocam no certificado real.
const chaves = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = chaves.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date(Date.now() - 86400000);
cert.validity.notAfter = new Date(Date.now() + 86400000 * 30);
cert.setSubject([{ name: 'commonName', value: 'TESTE:61587327000104' }]);
cert.setIssuer([{ name: 'commonName', value: 'TESTE' }]);
cert.sign(chaves.privateKey, forge.md.sha256.create());
const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], 'teste', { algorithm: '3des' });
writeFileSync(join(dir, 'teste.pfx'), Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
process.env.PFX_PATH = join(dir, 'teste.pfx');
process.env.PFX_SENHA = 'teste';

const { db, kvSet, salvarJson } = await import('../server/db.ts');
const { processar } = await import('../server/modulos/nfse/conversa.ts');
const { definirTransporte } = await import('../server/modulos/nfse/adn/adapter.ts');
const { ajustarDps } = await import('../server/modulos/nfse/adn/xml.ts');
const { montarDps, dataLocal } = await import('../server/modulos/nfse/motor.ts');
const { obterNfse, listarNfse } = await import('../server/modulos/nfse/notas.ts');
const { buscarServicos, servicoNacional } = await import('../server/modulos/nfse/servicos.ts');
const parser = await import('../server/modulos/nfse/parser.ts');
const { gerarDanfse, lerNfse } = await import('../server/modulos/nfse/danfse.ts');
const { DefaultNFSeXmlBuilder } = await import('@brasil-fiscal/nfse');

const endereco = { logradouro: 'RUA A', numero: '1', bairro: 'CENTRO', codigoMunicipio: '3504503', municipio: 'AVARE', uf: 'SP', cep: '18707150' };
const emitenteMei = { cnpj: '61587327000104', razaoSocial: 'EMPRESA DE TESTE', ie: null, crt: 4, regimeSimples: 'mei', endereco };
const tomadorCnpj = { tipo: 'CNPJ', doc: '11222333000181', nome: 'CLIENTE TESTE LTDA', ie: null, endereco: { ...endereco, numero: '200' } };

// ---------- ADN simulado ----------
type Cenario = 'autoriza' | 'rejeita' | 'timeout' | 'servidor';
let cenario: Cenario = 'autoriza';
let enviados: string[] = [];
let consultaDps: 'gerada' | 'nao' = 'gerada';
const CHAVE = '35045032261587327000104000000000000726110000000017';

const nfseXml = (dps: string, n = 7) =>
  `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${CHAVE}"><xLocEmi>Avaré</xLocEmi><xLocPrestacao>Avaré</xLocPrestacao>` +
  `<nNFSe>${n}</nNFSe><xTribNac>Assessoria ou consultoria</xTribNac><ambGer>2</ambGer><dhProc>2026-11-03T10:00:00-03:00</dhProc>` +
  `<emit><CNPJ>61587327000104</CNPJ><xNome>EMPRESA DE TESTE</xNome></emit><valores><vLiq>1500.00</vLiq></valores>${dps.replace(/<\?xml[^>]*>/, '')}</infNFSe></NFSe>`;

const json = (statusCode: number, corpo: unknown) => ({ statusCode, body: JSON.stringify(corpo) });

before(() => {
  kvSet('emitente', emitenteMei);
  definirTransporte({
    async postJson(url: string, body: { dpsXmlGZipB64?: string; pedidoRegistroEventoXmlGZipB64?: string }) {
      if (url.endsWith('/eventos')) return json(201, { eventoXmlGZipB64: gzipSync('<evento/>').toString('base64') });
      const dps = gunzipSync(Buffer.from(body.dpsXmlGZipB64!, 'base64')).toString('utf-8');
      enviados.push(dps);
      if (cenario === 'timeout') throw new Error('Sem resposta do ADN em 45 s');
      if (cenario === 'servidor') return { statusCode: 503, body: '<html>Service Unavailable</html>' };
      // Formato do swagger da Sefin (NFSePostResponseErro): campos em minusculas.
      if (cenario === 'rejeita') return json(400, { tipoAmbiente: 2, idDPS: 'x', erros: [{ codigo: 'E0116', descricao: 'A IM deve ser informada', complemento: null }] });
      return json(201, { chaveAcesso: CHAVE, idDps: dps.match(/Id="(DPS\d{42})"/)![1], nfseXmlGZipB64: gzipSync(nfseXml(dps)).toString('base64') });
    },
    async get(url: string) {
      if (url.includes('/dps/')) return consultaDps === 'gerada' ? json(200, { chaveAcesso: CHAVE }) : json(404, {});
      if (url.includes('/nfse/')) return json(200, { chaveAcesso: CHAVE, nfseXmlGZipB64: gzipSync(nfseXml(enviados.at(-1)!, 8)).toString('base64') });
      if (url.includes('/parametrizacao/3504503/convenio')) return json(200, { parametrosConvenio: { aderenteAmbienteNacional: 1, aderenteEmissorNacional: 1 }, mensagem: 'Parâmetros do convênio recuperados com sucesso.' });
      return json(404, {});
    },
    async getBinary() {
      return { statusCode: 503, body: Buffer.from('Service Unavailable') };
    }
  } as never);
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
});

async function rascunhoCompleto() {
  salvarJson('clientes', 'doc', tomadorCnpj.doc, tomadorCnpj);
  await processar('cancelar');
  return processar('consultoria tributária 1.500,00 código 17.01 para 11.222.333/0001-81');
}

// ---------- texto ----------
test('le valor, codigo, e-mail e tomador do texto do servico', () => {
  assert.equal(parser.extrairValorServico('consultoria tributária 1.500,00 para 11.222.333/0001-81'), 1500);
  assert.equal(parser.extrairValorServico('manutenção de site R$ 350'), 350);
  assert.equal(parser.extrairValorServico('aula de inglês por 120'), 120);
  assert.equal(parser.extrairValorServico('para 529.982.247-25'), null);
  assert.equal(parser.extrairCodigoServico('consultoria codigo 17.01'), '170101');
  assert.equal(parser.extrairCodigoServico('17.20.01 · Consultoria'), '172001');
  assert.equal(parser.extrairCodigoServico('1720', true), '172001');
  assert.equal(parser.extrairCodigoServico('valor 15.50'), null);
  assert.equal(parser.extrairDescricao('consultoria tributária 1.500,00 para 11.222.333/0001-81'), 'consultoria tributária');
  assert.equal(parser.extrairDescricao('prestei serviço de manutenção de site R$ 350 para cpf 529.982.247-25'), 'manutenção de site');
  assert.equal(parser.extrairEmail('para 529.982.247-25 email Ana@Exemplo.com.br'), 'ana@exemplo.com.br');
  assert.equal(parser.semTomador('sem tomador'), true);
  assert.deepEqual(parser.extrairComando('cancelar nota 12'), { tipo: 'cancelar_nota', numero: 12 });
  assert.equal(parser.extrairImEmitente('im 12.345-6'), '123456');
  assert.equal(parser.extrairImEmitente('im não tenho'), null);
  assert.equal(parser.extrairPercentualSimples('tributos 6,5%'), 6.5);
});

test('sugere o codigo da lista nacional pela descricao', () => {
  assert.ok(buscarServicos('consultoria tributária').some((s) => s.codigo === '170101'));
  assert.equal(buscarServicos('desenvolvimento de sistemas')[0].codigo, '010101');
  assert.equal(servicoNacional('070201')?.grupoObrigatorio, 'obra');
});

// ---------- regras da DPS ----------
const rascunho = { descricao: 'Consultoria', codigo: '170101', valor: 1500, tomador: tomadorCnpj } as never;

test('MEI: opSimpNac 2, sem IM, sem regApTribSN e sem percentual do Simples', () => {
  const dps = montarDps(rascunho, emitenteMei as never, { im: '999', pTotTribSN: 6 }, 1);
  assert.equal(dps.prestador.optanteSimplesNacional, 2);
  assert.equal(dps.prestador.inscricaoMunicipal, undefined);
  assert.equal(dps.prestador.regimeApuracaoSN, undefined);
  assert.equal(dps.valores.percentualTotalTributosSN, undefined);
  const xml = new DefaultNFSeXmlBuilder().build(dps);
  assert.match(xml, /<regTrib><opSimpNac>2<\/opSimpNac><regEspTrib>0<\/regEspTrib><\/regTrib>/);
  assert.match(xml, /<totTrib><indTotTrib>0<\/indTotTrib><\/totTrib>/);
});

test('ME/EPP: opSimpNac 3, regApTribSN 1 e percentual do Simples obrigatorio', () => {
  const me = { ...emitenteMei, crt: 1, regimeSimples: 'me_epp' } as never;
  assert.throws(() => montarDps(rascunho, me, { im: null }, 1), /percentual/);
  const xml = new DefaultNFSeXmlBuilder().build(montarDps(rascunho, me, { im: '12345', pTotTribSN: 6 }, 1));
  assert.match(xml, /<IM>12345<\/IM><regTrib><opSimpNac>3<\/opSimpNac><regApTribSN>1<\/regApTribSN><regEspTrib>0<\/regEspTrib>/);
  assert.match(xml, /<pTotTribSN>6.00<\/pTotTribSN>/);
  assert.doesNotMatch(xml, /indTotTrib/);
});

test('endereco do tomador entra depois do nome, e a versao do leiaute e trocada', () => {
  const dps = montarDps(rascunho, emitenteMei as never, {}, 3);
  const xml = ajustarDps(new DefaultNFSeXmlBuilder().build(dps), dps, { leiaute: '1.01', finNFSeNaDps: true });
  assert.match(xml, /<DPS xmlns="http:\/\/www.sped.fazenda.gov.br\/nfse" versao="1.01">/);
  // Leiaute da producao restrita (NT 009): finNFSe logo depois de tpEmit.
  assert.match(xml, /<tpEmit>1<\/tpEmit><finNFSe>0<\/finNFSe><cLocEmi>/);
  assert.match(xml, /<xNome>CLIENTE TESTE LTDA<\/xNome><end><endNac><cMun>3504503<\/cMun><CEP>18707150<\/CEP><\/endNac><xLgr>RUA A<\/xLgr><nro>200<\/nro><xBairro>CENTRO<\/xBairro><\/end><\/toma>/);
  assert.match(xml, /Id="DPS350450326158732700010400001000000000000003"/);
});

test('competencia usa a data do Brasil, nao a de Greenwich', () => {
  assert.equal(dataLocal(new Date('2026-11-04T01:30:00Z'), '-03:00'), '2026-11-03');
});

test('tomador CNPJ sem endereco nao vira DPS', () => {
  const semEndereco = { ...tomadorCnpj, endereco: undefined };
  assert.throws(() => montarDps({ ...(rascunho as object), tomador: semEndereco } as never, emitenteMei as never, {}, 1), /endereço/);
});

// ---------- conversa ----------
test('pergunta o que falta e nao transmite sem confirmacao', async () => {
  await processar('cancelar');
  const antes = enviados.length;
  const r = await processar('consultoria tributária 800');
  assert.match(r.at(-1)!.texto, /código da lista nacional/);
  assert.ok(r.at(-1)!.sugestoes?.includes('17.01.01'));
  const r2 = await processar('17.01.01');
  assert.match(r2.at(-1)!.texto, /CPF ou CNPJ/);
  const r3 = await processar('sem tomador');
  assert.match(r3.at(-1)!.texto, /Confere a NFS-e/);
  assert.match(r3.at(-1)!.texto, /não identificado/);
  assert.equal(enviados.length, antes);
  await processar('cancelar');
});

test('saudacao nao vira descricao de servico', async () => {
  await processar('cancelar');
  const r = await processar('bom dia');
  assert.match(r.at(-1)!.texto, /Qual serviço você prestou/);
});

test('NFS-e gerada: guarda chave, numero, XML e gera o DANFSe no emissor', async () => {
  cenario = 'autoriza';
  const resumo = await rascunhoCompleto();
  assert.match(resumo.at(-1)!.texto, /Confere a NFS-e/);
  const r = await processar('sim');
  assert.equal(r[0].nota?.status, 'autorizada');
  assert.equal(r[0].nota?.numeroNota, '7');
  const n = obterNfse(r[0].nota!.id)!;
  assert.equal(n.chave, CHAVE);
  assert.match(n.xml_dps!, /<Signature/);
  assert.match(n.xml_dps!, /<tpAmb>2<\/tpAmb>/);
  assert.match(n.xml_dps!, /<cTribNac>170101<\/cTribNac>/);
  assert.match(n.xml_dps!, /<opSimpNac>2<\/opSimpNac>/);
  assert.match(n.xml_nfse!, /<nNFSe>7<\/nNFSe>/);
  const pdf = await gerarDanfse(lerNfse(n.xml_nfse!, n.chave!));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  // NT 008: pagina unica e QR Code (imagem) no PDF.
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 1);
  assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
});

test('confirmacao repetida nao transmite de novo', async () => {
  const antes = enviados.length;
  const r = await processar('sim');
  assert.equal(enviados.length, antes);
  assert.equal(r.some((m) => m.nota), false);
});

test('servico usado volta pelo catalogo so com a descricao', async () => {
  await processar('cancelar');
  const r = await processar('consultoria tributária para 11.222.333/0001-81');
  assert.match(r.at(-1)!.texto, /Confere a NFS-e/);
  assert.match(r.at(-1)!.texto, /17\.01\.01/);
  assert.match(r.at(-1)!.texto, /R\$\s?1\.500,00/);
  await processar('cancelar');
});

test('rejeicao explica o codigo e reaproveita o numero da DPS', async () => {
  cenario = 'rejeita';
  await rascunhoCompleto();
  const r = await processar('sim');
  assert.equal(r[0].nota?.status, 'rejeitada');
  assert.match(r[0].texto, /E0116/);
  assert.match(r[0].texto, /Inscrição Municipal/);
  const numero = r[0].nota!.numero;
  cenario = 'autoriza';
  const de_novo = await processar('sim');
  assert.equal(de_novo[0].nota?.status, 'autorizada');
  assert.equal(de_novo[0].nota?.numero, numero);
});

test('HTTP 5xx fica pendente: o ADN pode ter gerado a nota', async () => {
  cenario = 'servidor';
  await rascunhoCompleto();
  const r = await processar('sim');
  assert.equal(r[0].nota?.status, 'pendente');
  assert.match(r[0].texto, /Não vou reenviar/);
});

test('timeout fica pendente e a consulta pelo Id da DPS recupera a nota', async () => {
  cenario = 'timeout';
  await rascunhoCompleto();
  const r = await processar('sim');
  assert.equal(r[0].nota?.status, 'pendente');
  const pendente = r[0].nota!;

  cenario = 'autoriza';
  await rascunhoCompleto();
  const seguinte = await processar('sim');
  assert.equal(seguinte[0].nota?.numero, pendente.numero + 1);

  consultaDps = 'gerada';
  const c = await processar('consultar');
  assert.ok(c.some((m) => m.nota?.status === 'autorizada'));
  assert.equal(obterNfse(pendente.id)!.status, 'autorizada');
});

test('cancelamento pede confirmacao e marca a nota como cancelada', async () => {
  const autorizada = listarNfse(50).find((n) => n.status === 'autorizada' && n.numero_nfse)!;
  const pergunta = await processar(`cancelar nota ${autorizada.numero_nfse}`);
  assert.match(pergunta[0].texto, /Cancelar a \*NFS-e/);
  const r = await processar('sim');
  assert.equal(r[0].nota?.status, 'cancelada');
  assert.equal(obterNfse(autorizada.id)!.status, 'cancelada');
  const de_novo = await processar(`cancelar nota ${autorizada.numero_nfse}`);
  assert.match(de_novo[0].texto, /só nota autorizada/);
});

test('diagnostico mostra o convenio do municipio', async () => {
  const r = await processar('diagnostico');
  assert.match(r[0].texto, /Convênio de AVARE\/SP: ✅ ativo/);
  assert.match(r[0].texto, /Aderente ao emissor nacional: sim/);
  assert.match(r[0].texto, /MEI emite pelo Sistema Nacional/);
});
