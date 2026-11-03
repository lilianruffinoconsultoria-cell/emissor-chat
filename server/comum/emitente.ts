// Dados da empresa emitente, comuns a NF-e e NFS-e. Carregados uma vez e guardados no banco.
import type { EnderecoProps } from '@brasil-fiscal/nfe';
import { kvGet, kvSet } from '../db.ts';
import { consultarCnpj } from '../integracoes/consultas.ts';
import { consultarCadastro } from '../modulos/nfe/sefaz/adapter.ts';

export type RegimeSimples = 'mei' | 'me_epp' | 'nao_optante';

export type Emitente = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  ie: string | null;
  crt: 1 | 4; // 1 = Simples Nacional, 4 = MEI
  // Da base publica do CNPJ: vale tambem para quem nao tem IE (prestador de servico).
  regimeSimples?: RegimeSimples;
  endereco: EnderecoProps;
};

/** O endereco da SEFAZ so sobrescreve o que ela realmente informou. */
function semVazios<T extends object>(o?: T): Partial<T> {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v)) as Partial<T>;
}

export async function emitente(): Promise<Emitente | null> {
  const cnpj = process.env.EMITENTE_CNPJ;
  if (!cnpj) return null;
  const salvo = kvGet<Emitente>('emitente');
  if (salvo?.cnpj === cnpj) return salvo;
  const e = await consultarCnpj(cnpj);
  if (!e?.endereco.uf) return null;
  // IE e regime vem da propria SEFAZ quando o CNPJ esta habilitado.
  const cadastro = await consultarCadastro(cnpj).catch(() => null);
  const habilitado = cadastro?.cStat === '111' || cadastro?.cStat === '112';
  const novo: Emitente = {
    cnpj,
    razaoSocial: e.razaoSocial,
    nomeFantasia: e.nomeFantasia,
    ie: habilitado ? cadastro?.ie ?? null : null,
    crt: habilitado && /MEI/i.test(cadastro?.regime ?? '') ? 4 : 1,
    regimeSimples: e.mei ? 'mei' : e.simples ? 'me_epp' : 'nao_optante',
    endereco: { ...e.endereco, ...semVazios(habilitado ? cadastro?.endereco : undefined) } as Emitente['endereco']
  };
  kvSet('emitente', novo);
  return novo;
}

export const salvarEmitente = (e: Emitente) => kvSet('emitente', e);
