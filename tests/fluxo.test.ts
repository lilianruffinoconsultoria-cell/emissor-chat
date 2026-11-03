// Fluxo do chat com a SEFAZ SIMULADA. Nada aqui comprova autorizacao real.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';

const dir = mkdtempSync(join(tmpdir(), 'emissor-teste-'));
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
const pfxTeste = join(dir, 'teste.pfx');
const { writeFileSync } = await import('node:fs');
writeFileSync(pfxTeste, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
process.env.PFX_PATH = pfxTeste;
process.env.PFX_SENHA = 'teste';

const { kvSet, listarNotas, obterNota } = await import('../server/db.ts');
const { processar } = await import('../server/modulos/nfe/conversa.ts');
const { danfe, definirTransporte } = await import('../server/modulos/nfe/sefaz/adapter.ts');

const emitente = {
  cnpj: '61587327000104', razaoSocial: 'EMPRESA DE TESTE LTDA', ie: '123456789012', crt: 1,
  endereco: { logradouro: 'RUA A', numero: '1', bairro: 'CENTRO', codigoMunicipio: '3504503', municipio: 'AVARE', uf: 'SP', cep: '18707150' }
};
const cliente = {
  tipo: 'CPF', doc: '52998224725', nome: 'MARIA SOUZA', ie: null,
  endereco: { logradouro: 'RUA B', numero: '2', bairro: 'CENTRO', codigoMunicipio: '3504503', municipio: 'AVARE', uf: 'SP', cep: '18707150' }
};

type Req = { xml: string };
const resposta = (cStat: string, xMotivo: string, chave: string) =>
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg><retEnviNFe versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>` +
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-11-02T20:00:00-03:00</dhRecbto><nProt>135260000000001</nProt><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>` +
  `</retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;

let cenario: 'autoriza' | 'rejeita' | 'timeout' = 'autoriza';
let envios = 0;

before(() => {
  kvSet('emitente', emitente);
  definirTransporte({
    async send(req: Req) {
      envios++;
      const chave = req.xml.match(/Id="NFe(\d{44})"/)![1];
      if (cenario === 'timeout') throw new Error('Timeout ao comunicar com SEFAZ');
      const xml = cenario === 'autoriza' ? resposta('100', 'Autorizado o uso da NF-e', chave) : resposta('778', 'NCM inexistente', chave);
      return { xml, statusCode: 200 };
    }
  } as never);
});

async function preparar() {
  const { salvarJson } = await import('../server/db.ts');
  salvarJson('clientes', 'doc', cliente.doc, cliente);
  await processar('cancelar');
  await processar('2 caixas de parafuso a 15,50 ncm 7318.15.00 para Maria Souza cpf 529.982.247-25 no pix');
}

test('pergunta o que falta e pede confirmacao antes de transmitir', async () => {
  await processar('cancelar');
  const r = await processar('2 caixas de parafuso a 15,50');
  assert.match(r.at(-1)!.texto, /NCM/);
  assert.equal(envios, 0);
});

test('nota autorizada: guarda protocolo, XML e gera DANFE', async () => {
  cenario = 'autoriza';
  await preparar();
  const antes = envios;
  const r = await processar('sim');
  assert.equal(r[0].nota?.status, 'autorizada');
  assert.equal(envios, antes + 1);
  const nota = obterNota(r[0].nota!.id)!;
  assert.equal(nota.total, 31);
  assert.match(nota.xml_protocolado!, /<nfeProc/);
  assert.match(nota.xml_enviado!, /NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL/);
  assert.match(nota.xml_enviado!, /<tpAmb>2<\/tpAmb>/);
  assert.match(nota.xml_enviado!, /<Signature/);
  assert.match(nota.xml_enviado!, /<tPag>17<\/tPag>/);
  assert.match(nota.xml_enviado!, /<tpIntegra>2<\/tpIntegra>/);
  const pdf = await danfe(nota.xml_protocolado!);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});

test('confirmacao repetida nao transmite de novo', async () => {
  const antes = envios;
  const r = await processar('sim');
  assert.equal(envios, antes);
  assert.equal(r.some((m) => m.nota), false);
});

test('cliente sem rua na base nao gera XML: o chat pergunta', async () => {
  const { salvarJson } = await import('../server/db.ts');
  const { logradouro: _sem, ...semRua } = cliente.endereco;
  salvarJson('clientes', 'doc', '11144477735', { ...cliente, doc: '11144477735', endereco: semRua });
  await processar('cancelar');
  const antes = envios;
  await processar('1 un prego a 5 ncm 7318.15.00 para Ana Lima cpf 111.444.777-35 no pix');
  // Sem rua no cadastro salvo o cliente segue incompleto: pede CEP ou rua, nunca transmite.
  const r = await processar('sim');
  assert.equal(envios, antes);
  assert.equal(r.some((m) => m.nota), false);
  await processar('cancelar');
});

test('emitente MEI sai com CRT 4 dentro do XML assinado', async () => {
  cenario = 'autoriza';
  kvSet('emitente', { ...emitente, crt: 4 });
  await preparar();
  const r = await processar('sim');
  kvSet('emitente', emitente);
  const nota = obterNota(r[0].nota!.id)!;
  assert.match(nota.xml_enviado!, /<CRT>4<\/CRT>/);
  assert.doesNotMatch(nota.xml_enviado!, /<CRT>1<\/CRT>/);
});

test('rejeicao explica o motivo e reaproveita o numero', async () => {
  cenario = 'rejeita';
  await preparar();
  const r = await processar('sim');
  assert.equal(r[0].nota?.status, 'rejeitada');
  assert.match(r[0].texto, /778/);
  const numeroRejeitado = r[0].nota!.numero;
  cenario = 'autoriza';
  const novamente = await processar('sim');
  assert.equal(novamente[0].nota?.status, 'autorizada');
  assert.equal(novamente[0].nota?.numero, numeroRejeitado);
});

test('timeout fica pendente, nao reenvia e nao libera o numero', async () => {
  cenario = 'timeout';
  await preparar();
  const r = await processar('sim');
  assert.equal(r[0].nota?.status, 'pendente');
  assert.match(r[0].texto, /Não vou reenviar/);
  const pendente = r[0].nota!;

  cenario = 'autoriza';
  await preparar();
  const seguinte = await processar('sim');
  assert.equal(seguinte[0].nota?.numero, pendente.numero + 1);
  assert.ok(listarNotas(50).some((n) => n.status === 'pendente'));
  (await import('../server/db.ts')).db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
});
