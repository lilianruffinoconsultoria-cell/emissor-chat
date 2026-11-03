// Regras da DPS versionadas. A versao usada fica gravada em cada NFS-e.
// Fonte: Anexo I (LeiautesRN DPS/NFS-e) v1.01 de 09/02/2026, aba "RN DPS_NFS-e".
export type RegrasNfse = {
  versao: string;
  vigenciaInicio: string;
  /** Versao do leiaute no atributo versao da DPS (TVerNFSe aceita 1.00 e 1.01). */
  leiaute: '1.00' | '1.01';
  /**
   * finNFSe dentro de infDPS, logo apos tpEmit (0 = NFS-e regular). Obrigatorio no leiaute da producao restrita
   * (NT 009, esquemas_prod_restrita_20261020); o XSD de producao de 09/02/2026 ainda nao tem o campo.
   */
  finNFSeNaDps: boolean;
  /** Faixa 00001 a 49999 e a do aplicativo proprio do contribuinte (E0010). */
  serie: number;
  /** Margem contra relogio adiantado: dhEmi nao pode passar do horario de processamento (E0008). */
  atrasoEmissaoSegundos: number;
  fuso: string;
};

export const REGRAS_NFSE_V1: RegrasNfse = {
  versao: 'nfse-sn-2026.2',
  vigenciaInicio: '2026-01-01',
  leiaute: '1.01',
  finNFSeNaDps: true,
  serie: 1,
  atrasoEmissaoSegundos: 60,
  fuso: '-03:00'
};

export const regrasNfseVigentes = (): RegrasNfse => REGRAS_NFSE_V1;
