// Texto livre da venda de mercadoria: itens, NCM, CFOP, pagamento e comandos da NF-e.
import { normal, numeroBr } from '../../chat/parser.ts';
import type { ItemRascunho } from './fiscal/motor.ts';

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

/** "ie 123456789" ou "inscricao estadual isento": troca a IE do emitente a qualquer momento. */
export function extrairIeEmitente(texto: string): string | null {
  const m = normal(texto).match(/^(?:minha )?(?:ie|inscricao estadual)[:\s]+([\d.\-/\s]+|isento)$/);
  if (!m) return null;
  if (m[1].trim() === 'isento') return 'ISENTO';
  const so = m[1].replace(/\D/g, '');
  return so.length >= 2 && so.length <= 14 ? so : null;
}

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
