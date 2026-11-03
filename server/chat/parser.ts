// Interpreta texto livre em portugues, comum a todos os modulos. Funcoes puras, sem acesso a banco ou rede.

export const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
export const normal = (s: string) => semAcento(s).toLowerCase().trim();

export function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n: number) => {
    let soma = 0;
    let peso = n - 7;
    for (let i = 0; i < n; i++) {
      soma += Number(c[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

export function cpfValido(c: string): boolean {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export type DocEncontrado = { tipo: 'CPF' | 'CNPJ'; doc: string; valido: boolean; trecho: string };

export const RE_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;
export const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;

export function extrairDocumento(texto: string): DocEncontrado | null {
  const cnpj = texto.match(RE_CNPJ);
  if (cnpj) {
    const doc = cnpj[0].replace(/\D/g, '');
    return { tipo: 'CNPJ', doc, valido: cnpjValido(doc), trecho: cnpj[0] };
  }
  const cpf = texto.match(RE_CPF);
  if (cpf) {
    const doc = cpf[0].replace(/\D/g, '');
    return { tipo: 'CPF', doc, valido: cpfValido(doc), trecho: cpf[0] };
  }
  return null;
}

/** Aceita 1.234,56 / 1234,56 / 1234.56 / 15 */
export function numeroBr(s: string): number | null {
  let v = s.trim();
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function extrairValor(texto: string): number | null {
  const m =
    texto.match(/r\$\s*(\d[\d.,]*)/i) ??
    texto.match(/(\d[\d.,]*)\s*(?:reais|real)\b/i) ??
    texto.match(/^\s*(\d[\d.,]*)\s*$/);
  return m ? numeroBr(m[1].replace(/[.,]$/, '')) : null;
}

export const extrairCep = (texto: string): string | null =>
  texto.match(/\b(\d{5}-?\d{3})\b/)?.[1].replace('-', '') ?? null;

export function extrairNomeCliente(texto: string): string | null {
  const m = texto.match(/\b(?:para|pro|pra)\s+(?:o |a )?(?:cliente\s+)?((?:\p{Lu}[\p{L}'.]*\s*)+)/u);
  const nome = m?.[1].trim();
  return nome && nome.length >= 3 ? nome : null;
}

export const ehConfirmacao = (t: string) =>
  /^(sim|s|ok|okay|pode|pode emitir|emitir|emite|emita|confirmo|confirmar|manda|manda ver|bora|isso|certo|fechado)\b/.test(normal(t));

export const ehNegacao = (t: string) => /^(nao|n|negativo|nem|nenhum|nenhuma)\b/.test(normal(t));
