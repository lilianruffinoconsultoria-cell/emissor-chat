// Motor fiscal: transforma o rascunho do chat em NFeProps. Nao conhece SOAP nem SEFAZ.
import type { EnderecoProps, NFeProps, ProdutoProps } from '@brasil-fiscal/nfe';
import type { Emitente } from '../../../comum/emitente.ts';
import { regrasVigentes, type RegrasFiscais } from './regras.ts';

export type { Emitente };

export const HOMOLOGACAO_DEST = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export type ItemRascunho = {
  descricao: string;
  quantidade: number;
  unidade: string;
  valorUnitario?: number;
  ncm?: string;
};

export type DestinatarioRascunho = {
  tipo: 'CPF' | 'CNPJ';
  doc: string;
  nome?: string;
  ie?: string | null; // undefined = ainda nao perguntado; null = nao contribuinte
  email?: string;
  endereco?: Partial<EnderecoProps>;
};

export type Rascunho = {
  itens: ItemRascunho[];
  destinatario?: DestinatarioRascunho;
  pagamento?: { codigo: string; nome: string };
  cfop?: string;
  observacao?: string;
};

// Cartao, PIX e transferencia exigem o grupo card (rejeicao 391). 2 = pagamento nao integrado ao sistema.
const EXIGE_GRUPO_CARD = new Set(['03', '04', '17', '18']);

const centavos = (v: number) => Math.round(v * 100);

export const totalItem = (i: ItemRascunho) => centavos(i.quantidade * (i.valorUnitario ?? 0)) / 100;

/** Valores de IBS e CBS por item, arredondados como no XML. */
export function tributosReforma(r: Rascunho, regras: RegrasFiscais = regrasVigentes()) {
  const { pIBSUF, pIBSMun, pCBS } = regras.ibsCbs;
  const soma = (p: number) => r.itens.reduce((t, i) => t + Math.round(totalItem(i) * p), 0) / 100;
  return { ibs: soma(pIBSUF) + soma(pIBSMun), cbs: soma(pCBS) };
}

export const totalNota = (r: Rascunho) =>
  r.itens.reduce((soma, i) => soma + centavos(totalItem(i)), 0) / 100;

export function cfopDa(r: Rascunho, emitente: Emitente, regras: RegrasFiscais = regrasVigentes()): string {
  if (r.cfop) return r.cfop;
  const interna = r.destinatario?.endereco?.uf === emitente.endereco.uf;
  if (interna) return regras.cfop.interna;
  return r.destinatario?.ie ? regras.cfop.interestadualContribuinte : regras.cfop.interestadualNaoContribuinte;
}

export function montarNFe(
  r: Rascunho,
  emitente: Emitente,
  numero: number,
  serie: number,
  regras: RegrasFiscais = regrasVigentes()
): NFeProps {
  const d = r.destinatario;
  if (!d?.endereco?.logradouro || !emitente.endereco.logradouro || !r.pagamento || !r.itens.length || !emitente.ie) {
    throw new Error('Rascunho incompleto para montar a NF-e.');
  }
  const interna = d.endereco.uf === emitente.endereco.uf;
  const contribuinte = Boolean(d.ie);
  const cfop = cfopDa(r, emitente, regras);

  const produtos: ProdutoProps[] = r.itens.map((item, i) => ({
    numero: i + 1,
    codigo: String(i + 1).padStart(4, '0'),
    descricao: item.descricao,
    ncm: item.ncm!,
    cfop,
    unidade: item.unidade,
    quantidade: item.quantidade,
    valorUnitario: item.valorUnitario!,
    valorTotal: totalItem(item),
    icms: { origem: regras.origemPadrao, csosn: regras.csosnPadrao },
    pis: { cst: regras.pisCofinsCst },
    cofins: { cst: regras.pisCofinsCst },
    ...(regras.ibsCbs.informar
      ? {
          ibsCbs: {
            cst: regras.ibsCbs.cst,
            cClassTrib: regras.ibsCbs.cClassTrib,
            pIBSUF: regras.ibsCbs.pIBSUF,
            pIBSMun: regras.ibsCbs.pIBSMun,
            pCBS: regras.ibsCbs.pCBS
          }
        }
      : {})
  }));

  return {
    identificacao: {
      naturezaOperacao: 'VENDA DE MERCADORIA',
      tipoOperacao: 1,
      destinoOperacao: interna ? 1 : 2,
      finalidade: 1,
      consumidorFinal: contribuinte ? 0 : 1,
      // Presencial: indPres 2 a 5 e 9 exigem indIntermed, que a biblioteca ainda nao gera (rejeicao 434).
      presencaComprador: 1,
      uf: emitente.endereco.uf,
      municipio: emitente.endereco.codigoMunicipio,
      serie,
      numero,
      dataEmissao: new Date()
    },
    emitente: {
      cnpj: emitente.cnpj,
      razaoSocial: emitente.razaoSocial,
      nomeFantasia: emitente.nomeFantasia,
      inscricaoEstadual: emitente.ie,
      // A biblioteca so valida 1 a 3; o CRT 4 do MEI entra no XML pelo adaptador, antes de assinar.
      regimeTributario: 1,
      endereco: emitente.endereco
    },
    destinatario: {
      ...(d.tipo === 'CPF' ? { cpf: d.doc } : { cnpj: d.doc }),
      // Regra de homologacao: o nome do destinatario e fixo, o nome real fica nas observacoes.
      nome: HOMOLOGACAO_DEST,
      indicadorIE: contribuinte ? 1 : 9,
      inscricaoEstadual: contribuinte ? d.ie! : undefined,
      endereco: d.endereco as EnderecoProps
    },
    produtos,
    transporte: { modalidadeFrete: 9 },
    pagamento: {
      pagamentos: [
        {
          formaPagamento: r.pagamento.codigo,
          valor: totalNota(r),
          ...(EXIGE_GRUPO_CARD.has(r.pagamento.codigo) ? { tipoIntegracao: 2 as const } : {})
        }
      ]
    },
    informacoesComplementares: [`Destinatario informado no chat: ${d.nome ?? ''}`.trim(), r.observacao]
      .filter(Boolean)
      .join(' | ')
  };
}
