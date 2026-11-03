// Interpreta texto livre em portugues. Funcoes puras, sem acesso a banco ou rede.
import type { ItemRascunho } from '../fiscal/motor.ts';

export const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normal = (s: string) => semAcento(s).toLowerCase().trim();

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

export function extrairDocumento(texto: string): DocEncontrado | null {
  const cnpj = texto.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
  if (cnpj) {
    const doc = cnpj[0].replace(/\D/g, '');
    return { tipo: 'CNPJ', doc, valido: cnpjValido(doc), trecho: cnpj[0] };
  }
  const cpf = texto.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
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

const PAGAMENTOS: [RegExp, string, string][] = [
  [/\bpix\b/, '17', 'PIX'],
  [/\b(cartao de )?credito\b/, '03', 'Cartão de crédito'],
  [/\b(cartao de )?debito\b/, '04', 'Cartão de débito'],
  [/\bcartao\b/, '03', 'Cartão de crédito'],
  [/\bboleto\b/, '15', 'Boleto'],
  [/\b(dinheiro|especie|a vista)\b/, '01', 'Dinheiro'],
  [/\b(transferencia|ted|doc)\b/, '18', 'Transferência bancária'],
  [/\bcheque\b/, '02', 'Cheque'],
  [/\b(sem pagamento|fiado|a prazo)\b/, '90', 'Sem pagamento']
];

export function extrairPagamento(texto: string): { codigo: string; nome: string } | null {
  const t = normal(texto);
  for (const [re, codigo, nome] of PAGAMENTOS) if (re.test(t)) return { codigo, nome };
  return null;
}

export const extrairNcm = (texto: string): string | null => {
  const m = texto.match(/\bncm[:\s]*(\d{4}\.?\d{2}\.?\d{2})\b/i) ?? texto.match(/^\s*(\d{4}\.?\d{2}\.?\d{2})\s*$/);
  return m ? m[1].replace(/\D/g, '') : null;
};

export const extrairCfop = (texto: string): string | null =>
  texto.match(/\bcfop[:\s]*([1-7]\d{3})\b/i)?.[1] ?? null;

export const extrairCep = (texto: string): string | null =>
  texto.match(/\b(\d{5}-?\d{3})\b/)?.[1].replace('-', '') ?? null;

const UNIDADES: Record<string, string> = {
  un: 'UN', und: 'UN', unid: 'UN', unidade: 'UN', unidades: 'UN', peca: 'PC', pecas: 'PC', pc: 'PC', pcs: 'PC',
  cx: 'CX', caixa: 'CX', caixas: 'CX', kg: 'KG', quilo: 'KG', quilos: 'KG', kilo: 'KG', kilos: 'KG',
  g: 'G', l: 'L', litro: 'L', litros: 'L', m: 'M', metro: 'M', metros: 'M', par: 'PAR', pares: 'PAR',
  pacote: 'PCT', pacotes: 'PCT', pct: 'PCT', saco: 'SC', sacos: 'SC', fardo: 'FD', fardos: 'FD', duzia: 'DZ', duzias: 'DZ'
};

export const UNIDADES_VALIDAS = [...new Set(Object.values(UNIDADES))];

// Remove os trechos que nao descrevem mercadoria antes de procurar itens.
function limparParaItens(texto: string): string {
  return texto
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, ' ')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, ' ')
    .replace(/\bncm[:\s]*\d{4}\.?\d{2}\.?\d{2}\b/gi, ' ')
    .replace(/\bcfop[:\s]*\d{4}\b/gi, ' ')
    .replace(/\b(para|pro|pra)\s+(o |a )?(cliente |empresa )?(cnpj|cpf)?\s*$/gim, ' ')
    .replace(/\b(cnpj|cpf)\b/gi, ' ');
}

const RE_ITEM =
  /(\d+(?:[.,]\d+)?)\s*(?:x\s+)?([\p{L}][\p{L}\p{N}\s\-/.]*?)\s*(?:a|por|x|@|=|custando|cada uma? a|valor(?: de)?)\s*(?:r\$\s*)?(\d[\d.,]*)\s*(reais|real)?\s*(no total|total|cada)?/iu;

export function extrairItens(texto: string): ItemRascunho[] {
  const itens: ItemRascunho[] = [];
  const partes = limparParaItens(texto).split(/\n|;|\s\+\s|\s+e\s+(?=\d)|,\s+(?=\d+\s+\p{L})/u);
  for (const parte of partes) {
    const m = parte.match(RE_ITEM);
    if (!m) continue;
    const quantidade = numeroBr(m[1]);
    const valor = numeroBr(m[3].replace(/[.,]$/, ''));
    if (!quantidade || valor === null) continue;

    let descricao = m[2].trim().replace(/^(de|do|da)\s+/i, '');
    let unidade = 'UN';
    const primeira = normal(descricao).split(/\s+/)[0];
    if (UNIDADES[primeira]) {
      unidade = UNIDADES[primeira];
      const resto = descricao.split(/\s+/).slice(1).join(' ').replace(/^(de|do|da)\s+/i, '').trim();
      if (resto) descricao = resto;
    }
    const noTotal = /total/i.test(m[5] ?? '');
    itens.push({
      descricao: descricao.toUpperCase().slice(0, 120),
      quantidade,
      unidade,
      valorUnitario: noTotal ? Math.round((valor / quantidade) * 10000) / 10000 : valor
    });
  }
  return itens;
}

export function extrairNomeCliente(texto: string): string | null {
  const m = texto.match(/\b(?:para|pro|pra)\s+(?:o |a )?(?:cliente\s+)?((?:\p{Lu}[\p{L}'.]*\s*)+)/u);
  const nome = m?.[1].trim();
  return nome && nome.length >= 3 ? nome : null;
}

/** "ie 123456789" ou "inscricao estadual isento": troca a IE do emitente a qualquer momento. */
export function extrairIeEmitente(texto: string): string | null {
  const m = normal(texto).match(/^(?:minha )?(?:ie|inscricao estadual)[:\s]+([\d.\-/\s]+|isento)$/);
  if (!m) return null;
  if (m[1].trim() === 'isento') return 'ISENTO';
  const so = m[1].replace(/\D/g, '');
  return so.length >= 2 && so.length <= 14 ? so : null;
}

export const ehConfirmacao = (t: string) =>
  /^(sim|s|ok|okay|pode|pode emitir|emitir|emite|emita|confirmo|confirmar|manda|manda ver|bora|isso|certo|fechado)\b/.test(normal(t));

export const ehNegacao = (t: string) => /^(nao|n|negativo|nem|nenhum|nenhuma)\b/.test(normal(t));

export type Comando = 'ajuda' | 'cancelar' | 'notas' | 'status' | 'empresa' | 'nova' | 'consultar' | 'diagnostico';

export function extrairComando(texto: string): Comando | null {
  const t = normal(texto).replace(/[!?.]+$/, '');
  if (/^(ajuda|help|menu|o que voce faz|como funciona)$/.test(t)) return 'ajuda';
  if (/^(cancelar|cancela|limpar|recomecar|desistir|apagar)( nota| rascunho)?$/.test(t)) return 'cancelar';
  if (/^(notas|minhas notas|ver notas|historico|ultimas notas)$/.test(t)) return 'notas';
  if (/^(status|status sefaz|sefaz)$/.test(t)) return 'status';
  if (/^(empresa|emitente|minha empresa|meus dados)$/.test(t)) return 'empresa';
  if (/^(nova nota|nova|oi|ola|bom dia|boa tarde|boa noite|emitir nota|quero emitir)$/.test(t)) return 'nova';
  if (/^(consultar|consultar pendentes|pendentes)$/.test(t)) return 'consultar';
  if (/^(diagnostico|verificar habilitacao|habilitacao|cadastro)$/.test(t)) return 'diagnostico';
  return null;
}
