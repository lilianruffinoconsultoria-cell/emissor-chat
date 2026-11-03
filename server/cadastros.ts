// Clientes (destinatarios da NF-e e tomadores da NFS-e): usados pelo menu de cadastro e pelos modulos.
import type { EnderecoProps } from '@brasil-fiscal/nfe';
import { cnpjValido, cpfValido } from './chat/parser.ts';
import { config } from './config.ts';
import { excluirJson, listarJson, salvarJson } from './db.ts';
import { consultarCep, consultarCnpj } from './integracoes/consultas.ts';
import type { DestinatarioRascunho } from './modulos/nfe/fiscal/motor.ts';
import { consultarCadastro } from './modulos/nfe/sefaz/adapter.ts';

export class ErroCadastro extends Error {}

export const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
export const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export function salvarCliente(dados: Record<string, unknown>): DestinatarioRascunho {
  const doc = digitos(dados.doc);
  const tipo = doc.length === 14 ? 'CNPJ' : 'CPF';
  if (tipo === 'CNPJ' ? !cnpjValido(doc) : !cpfValido(doc)) throw new ErroCadastro('CPF ou CNPJ inválido.');

  const nome = texto(dados.nome, 60).toUpperCase();
  const ie = digitos(dados.ie);
  const email = texto(dados.email, 80).toLowerCase();
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

  if (nome.length < 2) throw new ErroCadastro('Informe o nome do cliente.');
  if (ie && (ie.length < 2 || ie.length > 14)) throw new ErroCadastro('Inscrição Estadual precisa ter de 2 a 14 dígitos.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroCadastro('E-mail inválido.');
  if (endereco.cep?.length !== 8) throw new ErroCadastro('CEP precisa ter 8 dígitos.');
  if (!endereco.logradouro) throw new ErroCadastro('Informe a rua.');
  if (!endereco.bairro) throw new ErroCadastro('Informe o bairro.');
  if (endereco.codigoMunicipio?.length !== 7 || !endereco.municipio || endereco.uf?.length !== 2) {
    throw new ErroCadastro('Município não identificado: confira o CEP.');
  }

  const cliente: DestinatarioRascunho = { tipo, doc, nome, ie: ie || null, email: email || undefined, endereco };
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
