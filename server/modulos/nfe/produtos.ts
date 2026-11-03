// Catalogo de produtos da NF-e: usado pelo menu de cadastro e pelo chat.
import { semAcento, numeroBr } from '../../chat/parser.ts';
import { ErroCadastro, texto, digitos } from '../../cadastros.ts';
import { buscarJson, excluirJson, listarJson, salvarJson } from '../../db.ts';
import type { ItemRascunho } from './fiscal/motor.ts';
import { UNIDADES_VALIDAS } from './parser.ts';

export type Produto = {
  ncm: string;
  descricao?: string;
  unidade?: string;
  valorUnitario?: number;
};

export const chaveProduto = (d: string) => d.trim().toUpperCase();

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
