import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cnpjValido, cpfValido, ehConfirmacao, ehNegacao, extrairCep, extrairDocumento, extrairNomeCliente, numeroBr } from '../server/chat/parser.ts';
import { extrairComando, extrairIeEmitente, extrairItens, extrairNcm, extrairPagamento } from '../server/modulos/nfe/parser.ts';

test('valida digitos de CNPJ e CPF', () => {
  assert.equal(cnpjValido('61587327000104'), true);
  assert.equal(cnpjValido('61587327000105'), false);
  assert.equal(cnpjValido('11111111111111'), false);
  assert.equal(cpfValido('52998224725'), true);
  assert.equal(cpfValido('52998224724'), false);
});

test('encontra documento no meio da frase', () => {
  assert.deepEqual(extrairDocumento('vendi para 61.587.327/0001-04 hoje'), {
    tipo: 'CNPJ', doc: '61587327000104', valido: true, trecho: '61.587.327/0001-04'
  });
  assert.equal(extrairDocumento('cpf 529.982.247-25')?.tipo, 'CPF');
  assert.equal(extrairDocumento('sem documento'), null);
});

test('entende valores no formato brasileiro', () => {
  assert.equal(numeroBr('1.234,56'), 1234.56);
  assert.equal(numeroBr('15,50'), 15.5);
  assert.equal(numeroBr('15.50'), 15.5);
  assert.equal(numeroBr('1.000'), 1000);
});

test('extrai item com unidade, valor e documento na mesma mensagem', () => {
  assert.deepEqual(extrairItens('2 caixas de parafuso a 15,50 para 61.587.327/0001-04 no pix'), [
    { descricao: 'PARAFUSO', quantidade: 2, unidade: 'CX', valorUnitario: 15.5 }
  ]);
});

test('extrai varios itens', () => {
  const itens = extrairItens('3 un martelo a 40 e 1,5 kg de prego por R$ 20,00');
  assert.equal(itens.length, 2);
  assert.equal(itens[0].descricao, 'MARTELO');
  assert.equal(itens[1].unidade, 'KG');
  assert.equal(itens[1].quantidade, 1.5);
});

test('valor no total vira valor unitario', () => {
  const [item] = extrairItens('4 cadeiras por 100 no total');
  assert.equal(item.valorUnitario, 25);
});

test('identifica pagamento, NCM, CEP e nome', () => {
  assert.equal(extrairPagamento('no PIX')?.codigo, '17');
  assert.equal(extrairPagamento('cartão de débito')?.codigo, '04');
  assert.equal(extrairNcm('ncm 7318.15.00'), '73181500');
  assert.equal(extrairCep('cep 18707-150'), '18707150');
  assert.equal(extrairNomeCliente('vendi para Maria Souza cpf 529.982.247-25'), 'Maria Souza');
});

test('reconhece comandos e confirmacoes', () => {
  assert.equal(extrairComando('Notas'), 'notas');
  assert.equal(extrairComando('Diagnóstico'), 'diagnostico');
  assert.equal(extrairComando('2 caixas de prego'), null);
  assert.equal(ehConfirmacao('Sim, emitir'), true);
  assert.equal(ehNegacao('não'), true);
});

test('altera IE do emitente por mensagem', () => {
  assert.equal(extrairIeEmitente('ie 123.456.789.012'), '123456789012');
  assert.equal(extrairIeEmitente('Inscrição Estadual isento'), 'ISENTO');
  assert.equal(extrairIeEmitente('ie abc'), null);
});
