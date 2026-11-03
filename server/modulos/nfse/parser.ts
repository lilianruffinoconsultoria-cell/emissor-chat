// Texto livre da prestacao de servico: codigo da lista nacional, valor, tomador e comandos da NFS-e.
import { normal, numeroBr, RE_CNPJ, RE_CPF } from '../../chat/parser.ts';
import { servicoNacional } from './servicos.ts';

const RE_EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;

export const extrairEmail = (texto: string): string | null => texto.match(RE_EMAIL)?.[0].toLowerCase() ?? null;

/** "17.01", "17.01.01", "codigo 170101" ou a resposta isolada a pergunta do codigo. Sem desdobro, vale o 01. */
export function extrairCodigoServico(texto: string, isolado = false): string | null {
  const m =
    texto.match(/\b(?:c[oó]d(?:igo)?\.?|item|subitem|lc\s*116|ctribnac|tributa[cç][aã]o nacional)[:\s]*(\d{2})[.\s]?(\d{2})(?:[.\s]?(\d{2}))?\b/i) ??
    texto.match(/\b(\d{2})\.(\d{2})\.(\d{2})\b/) ??
    (isolado ? texto.match(/^\s*(\d{2})\.?(\d{2})(?:\.?(\d{2}))?\b/) : null);
  if (!m) return null;
  const codigo = `${m[1]}${m[2]}${m[3] ?? '01'}`;
  return servicoNacional(codigo) ? codigo : null;
}

// Trechos que nao sao valor nem descricao do servico.
function semRuido(texto: string): string {
  return texto
    .replace(new RegExp(RE_CNPJ.source, 'g'), ' ')
    .replace(new RegExp(RE_CPF.source, 'g'), ' ')
    .replace(new RegExp(RE_EMAIL.source, 'gi'), ' ')
    .replace(/\b(?:c[oó]d(?:igo)?\.?|item|subitem|lc\s*116|ctribnac)[:\s]*\d{2}[.\s]?\d{2}(?:[.\s]?\d{2})?\b/gi, ' ')
    .replace(/\b\d{2}\.\d{2}\.\d{2}\b/g, ' ');
}

/** Valor do servico: "R$ 1.500", "1500 reais", "por 1.500,00", "valor 800" ou um numero com centavos. */
export function extrairValorServico(texto: string): number | null {
  const t = semRuido(texto);
  const m =
    t.match(/r\$\s*(\d[\d.,]*)/i) ??
    t.match(/(\d[\d.,]*)\s*(?:reais|real)\b/i) ??
    t.match(/\b(?:valor(?: de)?|por|de|a|total(?: de)?|custou|cobrei)\s+(\d[\d.,]*)/i) ??
    t.match(/(?:^|\s)(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?=\s|$)/) ??
    t.match(/(?:^|\s)(\d[\d.,]*)\s*$/);
  const v = m ? numeroBr(m[1].replace(/[.,]$/, '')) : null;
  return v && v > 0 ? Math.round(v * 100) / 100 : null;
}

/** O que sobra da mensagem depois de tirar valor, documento, tomador e comandos. */
export function extrairDescricao(texto: string): string | null {
  let d = semRuido(texto)
    .replace(/r\$\s*\d[\d.,]*/gi, ' ')
    .replace(/\d[\d.,]*\s*(?:reais|real)\b/gi, ' ')
    .replace(/\b(?:valor(?: de)?|por|total(?: de)?|custou|cobrei)\s+\d[\d.,]*/gi, ' ')
    .replace(/(?:^|\s)\d{1,3}(?:\.\d{3})*,\d{2}(?=\s|$)/g, ' ')
    .replace(/\b(?:para|pro|pra)\b.*$/i, ' ')
    .replace(/(?:^|\s)\d[\d.,]*\s*$/, ' ')
    .replace(/\b(?:cnpj|cpf|tomador|cliente|e-?mail|sem tomador|nao identificado|não identificado)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // "nota de", "prestei servico de": tira os prefixos em sequencia, nao so o primeiro.
  for (let antes = ''; antes !== d; ) {
    antes = d;
    d = d.replace(/^(?:nota|nfs-?e|emitir|emite|emita|fiz|prestei|presta[cç][aã]o|servi[cç]os?|de|do|da)\s+/i, '');
  }
  d = d.replace(/\s+(?:de|a|no valor|valor)$/i, '').trim();
  return d.length >= 3 && /\p{L}{3}/u.test(d) ? d.slice(0, 2000) : null;
}

export const semTomador = (t: string) =>
  /\b(sem tomador|tomador nao identificado|nao identificado|consumidor nao identificado|sem cpf|sem cnpj|sem documento)\b/.test(normal(t));

/** "im 12345": troca a Inscricao Municipal; "im nao tenho" a remove. */
export function extrairImEmitente(texto: string): string | null | undefined {
  const m = normal(texto).match(/^(?:minha )?(?:im|inscricao municipal)[:\s]+(.+)$/);
  if (!m) return undefined;
  if (/^(nao|nao tenho|sem|nenhuma|isento)\b/.test(m[1].trim())) return null;
  const so = m[1].replace(/[^\dA-Za-z]/g, '');
  return so.length >= 1 && so.length <= 15 ? so : undefined;
}

/** "tributos 6" ou "simples 6,5%": percentual aproximado de tributos do Simples (Lei 12.741/2012). */
export function extrairPercentualSimples(texto: string): number | null {
  const m = normal(texto).match(/^(?:tributos|simples|aliquota(?: do simples)?|percentual)[:\s]+(\d{1,2}(?:[.,]\d{1,2})?)\s*%?$/);
  const v = m ? numeroBr(m[1]) : null;
  return v !== null && v > 0 && v < 100 ? v : null;
}

export type ComandoNfse =
  | { tipo: 'ajuda' | 'cancelar' | 'notas' | 'status' | 'empresa' | 'nova' | 'consultar' | 'diagnostico' }
  | { tipo: 'cancelar_nota'; numero: number };

export function extrairComando(texto: string): ComandoNfse | null {
  const t = normal(texto).replace(/[!?.]+$/, '');
  const cancelarNota = t.match(/^cancelar (?:a )?(?:nota|nfs-?e|nfse)(?: n(?:o|umero|º)?)?\s*(\d+)$/);
  if (cancelarNota) return { tipo: 'cancelar_nota', numero: Number(cancelarNota[1]) };
  if (/^(ajuda|help|menu|o que voce faz|como funciona)$/.test(t)) return { tipo: 'ajuda' };
  if (/^(cancelar|cancela|limpar|recomecar|desistir|apagar)( rascunho)?$/.test(t)) return { tipo: 'cancelar' };
  if (/^(notas|minhas notas|ver notas|historico|ultimas notas)$/.test(t)) return { tipo: 'notas' };
  if (/^(status|status adn|adn|sefin)$/.test(t)) return { tipo: 'status' };
  if (/^(empresa|emitente|prestador|minha empresa|meus dados)$/.test(t)) return { tipo: 'empresa' };
  if (/^(nova nota|nova|oi|ola|bom dia|boa tarde|boa noite|emitir nota|quero emitir)$/.test(t)) return { tipo: 'nova' };
  if (/^(consultar|consultar pendentes|pendentes)$/.test(t)) return { tipo: 'consultar' };
  if (/^(diagnostico|convenio|municipio)$/.test(t)) return { tipo: 'diagnostico' };
  return null;
}
