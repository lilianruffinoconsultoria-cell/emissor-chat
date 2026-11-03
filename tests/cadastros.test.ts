import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'emissor-cad-'));
process.env.EMISSOR_DB = join(dir, 'c.db');
process.env.EMISSOR_DATA_DIR = dir;

const { db } = await import('../server/db.ts');
const { ErroCadastro, listarClientes, salvarCliente } = await import('../server/cadastros.ts');
const { itensDoCatalogo, listarProdutos, salvarProduto } = await import('../server/modulos/nfe/produtos.ts');
const { ajustarXml } = await import('../server/modulos/nfe/sefaz/xml.ts');

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
});

const endereco = { logradouro: 'Rua A', numero: '10', bairro: 'Centro', codigoMunicipio: '3504503', municipio: 'Avaré', uf: 'SP', cep: '18707-150' };

test('produto: valida NCM e valor, aceita valor brasileiro', () => {
  assert.throws(() => salvarProduto({ descricao: 'Prego', ncm: '123', valorUnitario: '1,00' }), ErroCadastro);
  assert.throws(() => salvarProduto({ descricao: 'Prego', ncm: '7318.15.00', valorUnitario: '0' }), ErroCadastro);
  const p = salvarProduto({ descricao: 'Prego fino', ncm: '7318.15.00', unidade: 'cx', valorUnitario: '1.234,50' });
  assert.deepEqual(p, { descricao: 'PREGO FINO', ncm: '73181500', unidade: 'CX', valorUnitario: 1234.5 });
  assert.equal(listarProdutos().length, 1);
});

test('destinatario: valida documento e exige endereco completo', () => {
  assert.throws(() => salvarCliente({ doc: '11111111111', nome: 'X', endereco }), /inválido/);
  assert.throws(() => salvarCliente({ doc: '529.982.247-25', nome: 'Maria', endereco: { ...endereco, logradouro: '' } }), /rua/);
  const c = salvarCliente({ doc: '529.982.247-25', nome: 'Maria', ie: '', endereco });
  assert.equal(c.tipo, 'CPF');
  assert.equal(c.ie, null);
  assert.equal(c.endereco?.cep, '18707150');
  assert.equal(listarClientes()[0].nome, 'MARIA');
});

test('chat acha produto cadastrado sem precisar repetir o preco', () => {
  const [item] = itensDoCatalogo('quero 3 prego fino para 529.982.247-25');
  assert.equal(item.quantidade, 3);
  assert.equal(item.valorUnitario, 1234.5);
  assert.equal(item.ncm, '73181500');
  assert.equal(itensDoCatalogo('oi tudo bem').length, 0);
  assert.equal(itensDoCatalogo('prego fino').length, 0);
});

test('total de IBS/CBS e a soma dos itens arredondados', () => {
  const item = (uf: string, cbs: string) =>
    `<det nItem="1"><gIBSUF><vIBSUF>${uf}</vIBSUF></gIBSUF><gIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><gCBS><vCBS>${cbs}</vCBS></gCBS></det>`;
  const total = '<IBSCBSTot><gIBSUF><vIBSUF>0.02</vIBSUF></gIBSUF><gIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.02</vIBS><gCBS><vCBS>0.13</vCBS></gCBS></IBSCBSTot>';
  const xml = ajustarXml(`<CRT>1</CRT>${item('0.01', '0.05')}${item('0.01', '0.05')}${item('0.01', '0.05')}${total}`, 4);
  const bloco = xml.match(/<IBSCBSTot>.*<\/IBSCBSTot>/)![0];
  assert.match(xml, /<CRT>4<\/CRT>/);
  assert.match(bloco, /<vIBSUF>0\.03<\/vIBSUF>/);
  assert.match(bloco, /<vIBS>0\.03<\/vIBS>/);
  assert.match(bloco, /<vCBS>0\.15<\/vCBS><vCredPres>0\.00<\/vCredPres><vCredPresCondSus>0\.00<\/vCredPresCondSus>/);
  assert.match(bloco, /<vIBS>0\.03<\/vIBS><vCredPres>0\.00<\/vCredPres>/);
  assert.equal(xml.match(/<\/gIBSMun><vIBS>0\.01<\/vIBS><gCBS>/g)?.length, 3);
});
