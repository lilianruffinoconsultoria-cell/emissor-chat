// Motor da NFS-e: transforma o rascunho do chat em DPS. Nao conhece HTTP nem o ADN.
import type { DPSProps } from '@brasil-fiscal/nfse';
import type { Emitente, RegimeSimples } from '../../comum/emitente.ts';
import type { DestinatarioRascunho } from '../nfe/fiscal/motor.ts';
import { regrasNfseVigentes, type RegrasNfse } from './regras.ts';
import { servicoNacional } from './servicos.ts';

/** Dados que so a NFS-e usa, perguntados no chat e guardados no banco. */
export type DadosPrestador = {
  im?: string | null; // undefined = ainda nao perguntado; null = sem inscricao municipal
  pTotTribSN?: number; // % aproximado de tributos do Simples (ME/EPP)
};

export type RascunhoNfse = {
  descricao?: string;
  codigo?: string; // cTribNac
  valor?: number;
  tomador?: DestinatarioRascunho | null; // undefined = ainda nao perguntado; null = nao identificado
};

export type EnderecoTomador = { cMun: string; CEP: string; xLgr: string; nro: string; xCpl?: string; xBairro: string };

/** A biblioteca nao gera o endereco do tomador; ele vai a parte e entra no XML antes da assinatura. */
export type DpsMontada = DPSProps & { tomadorEndereco?: EnderecoTomador };

export const regimeDo = (e: Emitente): RegimeSimples => e.regimeSimples ?? (e.crt === 4 ? 'mei' : 'me_epp');

export const ROTULO_REGIME: Record<RegimeSimples, string> = {
  mei: 'MEI',
  me_epp: 'Simples Nacional (ME/EPP)',
  nao_optante: 'Não optante do Simples'
};

export function enderecoTomador(t?: DestinatarioRascunho | null): EnderecoTomador | undefined {
  const e = t?.endereco;
  if (!e?.codigoMunicipio || e.cep?.length !== 8 || !e.logradouro || !e.bairro) return undefined;
  return { cMun: e.codigoMunicipio, CEP: e.cep, xLgr: e.logradouro, nro: e.numero || 'S/N', xCpl: e.complemento, xBairro: e.bairro };
}

/** O endereco do tomador e exigido com CNPJ (E0235) e quando o ISS e devido onde ele esta (E0234). */
export function exigeEnderecoTomador(r: RascunhoNfse): boolean {
  if (!r.tomador) return false;
  return r.tomador.tipo === 'CNPJ' || servicoNacional(r.codigo ?? '')?.incidencia === 'tomador';
}

/** Data no fuso do Brasil: a competencia nao pode ser posterior a data de emissao (E0015). */
export function dataLocal(d: Date, fuso: string): string {
  const [h, m] = fuso.replace(/[+-]/, '').split(':').map(Number);
  const sinal = fuso.startsWith('-') ? -1 : 1;
  return new Date(d.getTime() + sinal * (h * 60 + m) * 60000).toISOString().slice(0, 10);
}

export function montarDps(
  r: RascunhoNfse,
  emit: Emitente,
  prestador: DadosPrestador,
  numero: number,
  agora = new Date(),
  regras: RegrasNfse = regrasNfseVigentes()
): DpsMontada {
  const regime = regimeDo(emit);
  const servico = servicoNacional(r.codigo ?? '');
  if (!r.descricao || !servico || !(r.valor && r.valor > 0) || r.tomador === undefined || !emit.endereco.codigoMunicipio) {
    throw new Error('Rascunho incompleto para montar a DPS.');
  }
  if (regime === 'nao_optante') throw new Error('Este emissor só emite NFS-e para MEI e Simples Nacional (ME/EPP).');
  if (servico.grupoObrigatorio) throw new Error(`O código ${servico.codigo} exige o grupo ${servico.grupoObrigatorio}, que este emissor não envia.`);
  if (regime === 'me_epp' && prestador.pTotTribSN === undefined) throw new Error('Falta o percentual de tributos do Simples.');
  const t = r.tomador;
  if (t && t.doc.slice(0, 8) === emit.cnpj.slice(0, 8) && t.tipo === 'CNPJ') throw new Error('O tomador não pode ser o próprio prestador (E0202).');
  if (t && !t.nome) throw new Error('O tomador precisa de nome.');
  const tomadorEndereco = enderecoTomador(t);
  if (exigeEnderecoTomador(r) && !tomadorEndereco) throw new Error('Falta o endereço do tomador.');

  const dataEmissao = new Date(agora.getTime() - regras.atrasoEmissaoSegundos * 1000);
  const mei = regime === 'mei';

  return {
    dataEmissao,
    competencia: dataLocal(dataEmissao, regras.fuso),
    serie: regras.serie,
    numero,
    tipoEmitente: 1,
    codigoMunicipioEmissor: emit.endereco.codigoMunicipio,
    prestador: {
      cnpj: emit.cnpj,
      // MEI nunca informa IM (regras E0116 e E0120 excluem o MEI); ME/EPP so quando tem cadastro no municipio.
      inscricaoMunicipal: mei ? undefined : prestador.im ?? undefined,
      optanteSimplesNacional: mei ? 2 : 3,
      // regApTribSN: proibido para MEI (E0162), obrigatorio para ME/EPP (E0166). 1 = tributos pelo Simples.
      regimeApuracaoSN: mei ? undefined : 1,
      regimeEspecialTributacao: 0 // E0174 e E0175
    },
    tomador: t
      ? { ...(t.tipo === 'CNPJ' ? { cnpj: t.doc } : { cpf: t.doc }), nome: t.nome, email: t.email }
      : undefined,
    servico: {
      // Local da prestacao no municipio do prestador: o chat ainda nao pergunta outro local.
      codigoMunicipioPrestacao: emit.endereco.codigoMunicipio,
      codigoTributacaoNacional: servico.codigo,
      descricao: r.descricao
    },
    valores: {
      valorServico: r.valor,
      tributacaoISSQN: 1,
      retencaoISSQN: 1, // MEI nao pode ter retencao (E0583)
      // MEI: pTotTribSN proibido (E0710), vai indTotTrib=0. ME/EPP: pTotTribSN obrigatorio (E0712).
      percentualTotalTributosSN: mei ? undefined : prestador.pTotTribSN
    },
    tomadorEndereco
  };
}
