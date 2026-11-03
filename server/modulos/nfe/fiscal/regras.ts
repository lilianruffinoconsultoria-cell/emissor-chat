// Regras fiscais versionadas. A versao usada fica gravada em cada nota.
export type RegrasFiscais = {
  versao: string;
  vigenciaInicio: string;
  crt: 1 | 4;
  csosnPadrao: '102';
  origemPadrao: 0;
  pisCofinsCst: '49';
  cfop: { interna: string; interestadualContribuinte: string; interestadualNaoContribuinte: string };
  ibsCbs: { informar: boolean; cst: string; cClassTrib: string; pIBSUF: number; pIBSMun: number; pCBS: number; referencia: string };
};

export const REGRAS_SIMPLES_V1: RegrasFiscais = {
  versao: 'simples-mei-2026.2',
  vigenciaInicio: '2026-01-01',
  crt: 1,
  csosnPadrao: '102',
  origemPadrao: 0,
  pisCofinsCst: '49',
  cfop: {
    interna: '5102',
    interestadualContribuinte: '6102',
    interestadualNaoContribuinte: '6108'
  },
  // Grupo opcional para CRT 1 e 4 (regra UB12-10 so obriga CRT 3); tributacao deles so a partir de 2027.
  // Aliquotas do ano-teste 2026: CBS 0,9% e IBS 0,1%, sem efeito sobre o valor da nota.
  ibsCbs: {
    informar: true,
    cst: '000',
    cClassTrib: '000001',
    pIBSUF: 0.1,
    pIBSMun: 0,
    pCBS: 0.9,
    referencia: 'NT 2025.002-RTC v1.53 / LC 214/25'
  }
};

export const regrasVigentes = (): RegrasFiscais => REGRAS_SIMPLES_V1;
