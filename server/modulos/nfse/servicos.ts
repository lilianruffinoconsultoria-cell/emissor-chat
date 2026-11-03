// Lista de servicos nacional (cTribNac) e catalogo de servicos do proprio emitente.
import { readFileSync } from 'node:fs';
import { normal, numeroBr } from '../../chat/parser.ts';
import { ErroCadastro, texto } from '../../cadastros.ts';
import { buscarJson, excluirJson, listarJson, salvarJson } from '../../db.ts';

/** Onde o ISS e devido: estabelecimento do prestador, local da prestacao ou estabelecimento do tomador. */
export type Incidencia = 'prestador' | 'local' | 'tomador';

export type ServicoNacional = {
  codigo: string; // cTribNac, 6 digitos: item, subitem e desdobro
  descricao: string;
  item: string;
  incidencia: Incidencia;
  grupoObrigatorio: '' | 'obra' | 'atvEvento';
};

const arquivo = JSON.parse(readFileSync(new URL('./lista-servicos.json', import.meta.url), 'utf-8')) as {
  servicos: [string, string, string, Incidencia, ServicoNacional['grupoObrigatorio']][];
};

export const LISTA_NACIONAL: readonly ServicoNacional[] = arquivo.servicos.map(
  ([codigo, descricao, item, incidencia, grupoObrigatorio]) => ({ codigo, descricao, item, incidencia, grupoObrigatorio })
);

const porCodigo = new Map(LISTA_NACIONAL.map((s) => [s.codigo, s]));

export const servicoNacional = (codigo: string) => porCodigo.get(codigo);

export const formatarCodigo = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4, 6)}`;

const VAZIAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'as', 'os', 'para', 'por', 'com', 'sem', 'ou', 'que', 'no', 'na',
  'nos', 'nas', 'um', 'uma', 'servico', 'servicos', 'prestado', 'prestados', 'qualquer', 'natureza', 'geral', 'congeneres',
  'mes', 'referente', 'ref'
]);

/** Raiz grosseira para "consultoria" casar com "consultorias" e "consultor". */
const raiz = (p: string) => p.slice(0, Math.max(5, Math.ceil(p.length * 0.7)));

function palavras(s: string): string[] {
  return normal(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((p) => p.length >= 3 && !VAZIAS.has(p));
}

const indice = LISTA_NACIONAL.map((s) => ({ s, termos: palavras(`${s.descricao} ${s.descricao} ${s.item}`) }));

/** Os codigos da lista cuja descricao mais se parece com o texto. A escolha final e sempre de quem emite. */
export function buscarServicos(consulta: string, limite = 3): ServicoNacional[] {
  const termos = palavras(consulta);
  if (!termos.length) return [];
  return indice
    .map(({ s, termos: t }) => {
      let pontos = 0;
      for (const p of termos) {
        if (t.includes(p)) pontos += 3;
        else if (t.some((q) => q.startsWith(raiz(p)) || p.startsWith(raiz(q)))) pontos += 2;
      }
      // Descricao curta e especifica ganha da generica quando os dois casam.
      return { s, pontos: pontos - t.length / 200 };
    })
    .filter((r) => r.pontos >= 2)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, limite)
    .map((r) => r.s);
}

// Catalogo do emitente: descricao que ele usa -> codigo nacional e valor habitual.
export type Servico = { descricao: string; codigo: string; valor?: number };

export const chaveServico = (d: string) => normal(d).replace(/\s+/g, ' ').toUpperCase();

export function salvarServico(dados: Record<string, unknown>): Servico {
  const descricao = texto(dados.descricao, 2000).replace(/\s+/g, ' ');
  const codigo = String(dados.codigo ?? '').replace(/\D/g, '');
  const valor = dados.valor === undefined || dados.valor === '' ? undefined
    : typeof dados.valor === 'number' ? dados.valor : numeroBr(String(dados.valor)) ?? NaN;

  if (descricao.length < 3) throw new ErroCadastro('Descreva o serviço.');
  const nacional = servicoNacional(codigo);
  if (!nacional) throw new ErroCadastro('Código da lista nacional não encontrado. São 6 dígitos, por exemplo 17.01.01.');
  if (nacional.grupoObrigatorio) throw new ErroCadastro(`O código ${formatarCodigo(codigo)} exige dados de ${nacional.grupoObrigatorio === 'obra' ? 'obra' : 'evento'}, que este emissor ainda não envia.`);
  if (valor !== undefined && !(valor > 0)) throw new ErroCadastro('Informe um valor maior que zero ou deixe em branco.');

  const servico: Servico = { descricao, codigo, ...(valor ? { valor } : {}) };
  salvarJson('servicos', 'chave', chaveServico(descricao), servico);
  return servico;
}

export function listarServicos(): Servico[] {
  return listarJson<Servico>('servicos', 'chave')
    .map(({ dados }) => dados)
    .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

export const excluirServico = (descricao: string) => excluirJson('servicos', 'chave', chaveServico(descricao));

export const buscarServico = (descricao: string) => buscarJson<Servico>('servicos', 'chave', chaveServico(descricao));

/** Servico cadastrado citado na mensagem; o de descricao mais longa vence. */
export function servicoDoCatalogo(mensagem: string): Servico | null {
  const t = ` ${chaveServico(mensagem)} `;
  return listarServicos()
    .sort((a, b) => b.descricao.length - a.descricao.length)
    .find((s) => t.includes(` ${chaveServico(s.descricao)} `)) ?? null;
}
