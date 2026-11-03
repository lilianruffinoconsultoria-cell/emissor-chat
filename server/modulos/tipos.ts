// Contrato de um modulo fiscal. O servidor so conhece este contrato; cada documento (NF-e, NFS-e)
// tem a propria conversa, regras, comunicacao com o fisco, numeracao e rotas de arquivos.
import type { Router } from 'express';

export type IdModulo = 'nfe' | 'nfse';

export type CartaoNota = {
  modelo: IdModulo;
  id: number;
  numero: number;
  serie: number;
  status: string;
  total: number;
  /** Numero dado pelo orgao, quando difere do numero enviado (NFS-e: nNFSe x nDPS). */
  numeroNota?: string | null;
  chave?: string | null;
  protocolo?: string | null;
  cStat?: string | null;
  xMotivo?: string | null;
};

export type Resposta = { texto: string; sugestoes?: string[]; nota?: CartaoNota };

export type Modulo = {
  id: IdModulo;
  /** Nome do documento, como aparece na lista de conversas. */
  nome: string;
  /** O que se emite nele, em poucas palavras. */
  assunto: string;
  /** Orgao com que o modulo conversa, mostrado no cabecalho. */
  destino: string;
  mensagemInicial(): Resposta;
  processar(texto: string, origemMenu: boolean): Promise<Resposta[]>;
  /** Rotas proprias, montadas em /api/<id>. */
  rotas(router: Router): void;
};
