// Produtos e destinatarios: usados pelo menu de cadastro e pelo chat.
import type { EnderecoProps } from '@brasil-fiscal/nfe';
import { semAcento, cnpjValido, cpfValido, numeroBr, UNIDADES_VALIDAS } from './chat/parser.ts';
import { config } from './config.ts';
import { buscarJson, excluirJson, listarJson, salvarJson } from './db.ts';
import type { DestinatarioRascunho, ItemRascunho } from './fiscal/motor.ts';
import { consultarCep, consultarCnpj } from './integracoes/consultas.ts';
import { consultarCadastro } from './sefaz/adapter.ts';

export class ErroCadastro extends Error {}

export type Produto = {
  ncm: string;
  descricao?: string;
  unidade?: string;
  valorUnitario?: number;
};

export const chaveProduto = (d: string) => d.trim().toUpperCase();

const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export function salvarProduto(dados: Record<string, unknown>): Produto & { descricao: string } {
  const descricao = chaveProduto(texto(dados.descricao, 120));
  const ncm = digitos(dados.ncm);
  const unidade = texto(dados.unidade, 6).toUpperCase() || 'UN';
  const valorUnitario = typeof dados.valorUnitario === 'number' ? dados.valorUnitario : numeroBr(String(dados.valorUnitario ?? ''));

  if (descricao.length < 2) throw new ErroCadastro('Informe a descrição do produto.');
  if (ncm.length !== 8) throw new ErroCadastro('NCM precisa ter 8 dígitos.');
  if (!UNIDADES_VALIDAS.includes(unidade)) throw new ErroCadastro('Unidade inválida.');
  if (valorUnitario === null || !(valorUnitario > 0)) throw new ErroCadastro('Informe um valor maior que zero.');

  const produto = { descricao, ncm, unidade, valorUnitario };
  salvarJson('produtos', 'chave', descricao, produto);
  return produto;
}

export function listarProdutos(): (Produto & { descricao: string })[] {
  return listarJson<Produto>('produtos', 'chave')
    .map(({ id, dados }) => ({ ...dados, descricao: dados.descricao ?? id }))
    .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

export const excluirProduto = (descricao: string) => excluirJson('produtos', 'chave', chaveProduto(descricao));

export function salvarCliente(dados: Record<string, unknown>): DestinatarioRascunho {
  const doc = digitos(dados.doc);
  const tipo = doc.length === 14 ? 'CNPJ' : 'CPF';
  if (tipo === 'CNPJ' ? !cnpjValido(doc) : !cpfValido(doc)) throw new ErroCadastro('CPF ou CNPJ inválido.');

  const nome = texto(dados.nome, 60).toUpperCase();
  const ie = digitos(dados.ie);
  const e = (dados.endereco ?? {}) as Record<string, unknown>;
  const endereco: Partial<EnderecoProps> = {
    logradouro: texto(e.logradouro, 60).toUpperCase(),
    numero: texto(e.numero, 20).toUpperCase() || 'S/N',
    complemento: texto(e.complemento, 60).toUpperCase() || undefined,
    bairro: texto(e.bairro, 60).toUpperCase(),
    codigoMunicipio: digitos(e.codigoMunicipio),
    municipio: texto(e.municipio, 60).toUpperCase(),
    uf: texto(e.uf, 2).toUpperCase(),
    cep: digitos(e.cep)
  };

  if (nome.length < 2) throw new ErroCadastro('Informe o nome do destinatário.');
  if (ie && (ie.length < 2 || ie.length > 14)) throw new ErroCadastro('Inscrição Estadual precisa ter de 2 a 14 dígitos.');
  if (endereco.cep?.length !== 8) throw new ErroCadastro('CEP precisa ter 8 dígitos.');
  if (!endereco.logradouro) throw new ErroCadastro('Informe a rua.');
  if (!endereco.bairro) throw new ErroCadastro('Informe o bairro.');
  if (endereco.codigoMunicipio?.length !== 7 || !endereco.municipio || endereco.uf?.length !== 2) {
    throw new ErroCadastro('Município não identificado: confira o CEP.');
  }

  const cliente: DestinatarioRascunho = { tipo, doc, nome, ie: ie || null, endereco };
  salvarJson('clientes', 'doc', doc, cliente);
  return cliente;
}

export function listarClientes(): DestinatarioRascunho[] {
  return listarJson<DestinatarioRascunho>('clientes', 'doc')
    .map(({ dados }) => dados)
    .sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'));
}

export const excluirCliente = (doc: string) => excluirJson('clientes', 'doc', digitos(doc));

export type DadosEncontrados = { nome?: string; ie?: string | null; endereco?: Partial<EnderecoProps>; situacao?: string };

/** Base publica para nome e endereco; SEFAZ da UF para IE e para completar o que faltar. */
export async function buscarPorCnpj(cnpj: string): Promise<DadosEncontrados | null> {
  const publica = await consultarCnpj(cnpj);
  const achado: DadosEncontrados = publica
    ? { nome: publica.razaoSocial, endereco: publica.endereco, situacao: publica.situacao }
    : {};

  if (!publica || publica.endereco.uf === config.uf) {
    const cadastro = await consultarCadastro(cnpj).catch(() => null);
    if (cadastro?.cStat === '111' || cadastro?.cStat === '112') {
      const informado = Object.fromEntries(Object.entries(cadastro.endereco ?? {}).filter(([, v]) => v));
      const manterPublica = publica?.endereco.logradouro ? {} : informado;
      achado.endereco = { ...achado.endereco, ...manterPublica };
      if (cadastro.ie) achado.ie = cadastro.ie;
    }
  }
  return achado.nome || achado.endereco ? achado : null;
}

export const buscarCep = (cep: string) => consultarCep(digitos(cep));

export function buscarProduto(descricao: string): Produto | null {
  return buscarJson<Produto>('produtos', 'chave', chaveProduto(descricao));
}

/** "2 parafusos" ou "duas vezes" nao bastam: so casa produto cadastrado, com preco, e com quantidade. */
export function itensDoCatalogo(mensagem: string): ItemRascunho[] {
  const t = semAcento(mensagem).toUpperCase().replace(/\b\d{11,14}\b|\d{2,3}\.\d{3}\.\d{3}[/-]?\S*/g, ' ');
  const itens: ItemRascunho[] = [];
  const catalogo = listarProdutos()
    .filter((p) => p.valorUnitario)
    .sort((a, b) => b.descricao.length - a.descricao.length);

  let resto = t;
  for (const p of catalogo) {
    const nome = semAcento(p.descricao).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = resto.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:[A-Z]+\\s+){0,3}?${nome}\\b`));
    if (!m) continue;
    const quantidade = numeroBr(m[1]);
    if (!quantidade) continue;
    resto = resto.replace(m[0], ' ');
    itens.push({
      descricao: p.descricao,
      quantidade,
      unidade: p.unidade ?? 'UN',
      valorUnitario: p.valorUnitario,
      ncm: p.ncm
    });
  }
  return itens;
}
