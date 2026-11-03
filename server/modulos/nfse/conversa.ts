// Conversa da NFS-e (servicos): mantem o rascunho, pergunta o que falta e dispara a emissao no ADN.
import { buscarCep, buscarPorCnpj } from '../../cadastros.ts';
import { ehConfirmacao, ehNegacao, extrairCep, extrairDocumento, extrairNomeCliente } from '../../chat/parser.ts';
import { emitente, type Emitente } from '../../comum/emitente.ts';
import { buscarJson, kvDel, kvGet, kvSet, registrarAuditoria, salvarJson } from '../../db.ts';
import type { DestinatarioRascunho } from '../nfe/fiscal/motor.ts';
import type { CartaoNota, Resposta } from '../tipos.ts';
import { cancelarNfse, consultarPorDps, convenioMunicipio, emitirNfse, idDps, type ResultadoNfse } from './adn/adapter.ts';
import { CADASTRAIS_NFSE, explicarNfse } from './explicacoes.ts';
import { enderecoTomador, exigeEnderecoTomador, montarDps, regimeDo, ROTULO_REGIME, type DadosPrestador, type RascunhoNfse } from './motor.ts';
import { atualizarNfse, listarNfse, nfsePendentes, nfsePorNumero, obterNfse, reservarNfse, type NfseRow } from './notas.ts';
import {
  extrairCodigoServico,
  extrairComando,
  extrairDescricao,
  extrairEmail,
  extrairImEmitente,
  extrairPercentualSimples,
  extrairValorServico,
  semTomador,
  type ComandoNfse
} from './parser.ts';
import { regrasNfseVigentes } from './regras.ts';
import { buscarServicos, chaveServico, formatarCodigo, servicoDoCatalogo, servicoNacional } from './servicos.ts';

type Etapa =
  | 'im' | 'tributos' | 'descricao' | 'codigo' | 'valor' | 'tomador' | 'nome'
  | 'cep' | 'logradouro' | 'numero' | 'bairro' | 'confirmar' | 'confirmar_cancelamento';

type Estado = { rascunho: RascunhoNfse; etapa: Etapa | null; sugeridos?: string[]; cancelar?: number };

// Nessas etapas a resposta e um dado isolado: digitos de IM ou CEP nao podem virar CPF nem valor.
const ETAPAS_DIRETAS = new Set<Etapa>(['im', 'tributos', 'nome', 'cep', 'logradouro', 'numero', 'bairro', 'codigo']);
const CHAVE_ESTADO = 'nfse:conversa';
const CHAVE_PRESTADOR = 'nfse:prestador';
const MOTIVO_PADRAO = 'Cancelamento por erro na emissao da nota fiscal';
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const curto = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const vazio = (): Estado => ({ rascunho: {}, etapa: null });
const prestador = () => kvGet<DadosPrestador>(CHAVE_PRESTADOR) ?? {};
const salvarPrestador = (p: DadosPrestador) => kvSet(CHAVE_PRESTADOR, p);

const numeroNfse = (xml?: string | null) => xml?.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1] ?? null;

function cartao(n: NfseRow): CartaoNota {
  return {
    modelo: 'nfse', id: n.id, numero: n.numero, serie: n.serie, status: n.status, total: n.total,
    numeroNota: n.numero_nfse, chave: n.chave, cStat: n.codigo, xMotivo: n.motivo
  };
}

function sugestoesDeCodigo(descricao: string): string[] {
  return buscarServicos(descricao).map((s) => s.codigo);
}

function aplicarExtracao(texto: string, estado: Estado, avisos: string[], origemMenu: boolean): DestinatarioRascunho | null {
  const r = estado.rascunho;
  const explicita = texto.match(/^\s*descri[cç][aã]o[:\s]+(.{3,})$/i)?.[1].trim();
  if (explicita) {
    r.descricao = explicita.slice(0, 2000);
    return null;
  }

  // Servico escolhido no menu troca o do rascunho; citado no chat, so preenche o que falta.
  const catalogo = servicoDoCatalogo(texto);
  if (catalogo && (!r.descricao || origemMenu)) {
    r.descricao = catalogo.descricao;
    r.codigo = catalogo.codigo;
    if (catalogo.valor) r.valor = catalogo.valor;
  }

  const codigo = extrairCodigoServico(texto);
  if (codigo) definirCodigo(r, codigo, avisos);
  const valor = extrairValorServico(texto);
  if (valor) r.valor = valor;

  let novo: DestinatarioRascunho | null = null;
  const doc = extrairDocumento(texto);
  if (doc) {
    if (!doc.valido) avisos.push(`Esse ${doc.tipo} *${doc.trecho}* não é válido (dígito verificador não confere).`);
    else if (r.tomador?.doc !== doc.doc) {
      novo = { tipo: doc.tipo, doc: doc.doc, nome: extrairNomeCliente(texto) ?? undefined };
      r.tomador = novo;
    }
  } else if (semTomador(texto)) {
    r.tomador = null;
  }
  const email = extrairEmail(texto);
  if (email && r.tomador) r.tomador.email = email;

  // "sim" ou "nao" fora da confirmacao nao descrevem servico.
  if (!r.descricao && !ehConfirmacao(texto) && !ehNegacao(texto)) {
    const descricao = extrairDescricao(texto);
    if (descricao) r.descricao = descricao;
  }
  return novo;
}

function definirCodigo(r: RascunhoNfse, codigo: string, avisos: string[]): boolean {
  const s = servicoNacional(codigo);
  if (!s) {
    avisos.push('Esse código não está na lista nacional de serviços.');
    return false;
  }
  if (s.grupoObrigatorio) {
    avisos.push(`O código ${formatarCodigo(codigo)} exige dados de ${s.grupoObrigatorio === 'obra' ? 'obra' : 'evento'}, que este emissor ainda não envia. Escolha outro código ou emita pelo Emissor Nacional.`);
    return false;
  }
  r.codigo = codigo;
  return true;
}

async function completarTomador(t: DestinatarioRascunho, avisos: string[]): Promise<void> {
  const salvo = buscarJson<DestinatarioRascunho>('clientes', 'doc', t.doc);
  if (salvo?.nome) {
    Object.assign(t, { ...salvo, nome: salvo.nome ?? t.nome, email: t.email ?? salvo.email });
    return;
  }
  if (t.tipo !== 'CNPJ') return;
  const e = await buscarPorCnpj(t.doc);
  if (!e) {
    avisos.push('Não consegui buscar esse CNPJ, vou pedir os dados aqui.');
    return;
  }
  t.nome = e.nome ?? t.nome;
  t.endereco = e.endereco;
  avisos.push(`Encontrei: *${e.nome}* (${e.endereco?.municipio}/${e.endereco?.uf})${e.situacao ? `, situação ${e.situacao}` : ''}.`);
}

function proxima(estado: Estado, emit: Emitente, p: DadosPrestador): Resposta | null {
  const r = estado.rascunho;
  const definir = (etapa: Etapa, texto: string, sugestoes?: string[]): Resposta => {
    estado.etapa = etapa;
    return { texto, sugestoes };
  };
  if (regimeDo(emit) === 'me_epp') {
    if (p.im === undefined) {
      return definir('im', 'Antes da primeira NFS-e: sua empresa tem *Inscrição Municipal* na prefeitura? Mande o número ou responda *não tenho*.', ['Não tenho']);
    }
    if (p.pTotTribSN === undefined) {
      return definir('tributos', 'Qual o *percentual aproximado de tributos* do Simples para informar na nota (Lei 12.741)? É a sua alíquota efetiva, por exemplo *6* ou *15,5*.');
    }
  }
  if (!r.descricao) {
    return definir('descricao', 'Qual serviço você prestou? Exemplo: _consultoria tributária 1.500,00 para 12.345.678/0001-95_', ['Abrir menu']);
  }
  if (!r.codigo) {
    // Na etapa do codigo, a busca refeita com as palavras de quem emite vale mais que a da descricao.
    if (estado.etapa !== 'codigo' || !estado.sugeridos?.length) estado.sugeridos = sugestoesDeCodigo(r.descricao);
    const opcoes = estado.sugeridos.map((c, i) => `${i + 1}. *${formatarCodigo(c)}* ${curto(servicoNacional(c)!.descricao, 90)}`);
    return definir(
      'codigo',
      opcoes.length
        ? ['Qual o *código da lista nacional* para esse serviço? Os mais parecidos:', '', ...opcoes, '', 'Toque em um deles ou mande outro código (ex.: *17.01*).'].join('\n')
        : 'Não achei o código pela descrição. Mande o *código da lista nacional* (item e subitem da LC 116, ex.: *17.01*).',
      estado.sugeridos.map(formatarCodigo)
    );
  }
  if (!r.valor) return definir('valor', `Qual o *valor* de _${curto(r.descricao, 60)}_?`);
  if (r.tomador === undefined) {
    return definir('tomador', 'Para quem foi o serviço? Mande o *CPF ou CNPJ* do tomador, ou responda *sem tomador*.', ['Sem tomador', 'Abrir menu']);
  }
  const t = r.tomador;
  if (t && !t.nome) return definir('nome', 'Qual o *nome* do tomador?');
  if (t && exigeEnderecoTomador(r) && !enderecoTomador(t)) {
    const e = t.endereco;
    if (!e?.codigoMunicipio || e.cep?.length !== 8) return definir('cep', 'Qual o *CEP* do tomador?');
    if (!e.logradouro) return definir('logradouro', 'Qual a *rua* do tomador?');
    if (!e.bairro) return definir('bairro', 'Qual o *bairro*?');
  }
  if (t && exigeEnderecoTomador(r) && !t.endereco?.numero) return definir('numero', 'Qual o *número* do endereço?', ['S/N']);
  return null;
}

function resumo(estado: Estado, emit: Emitente, p: DadosPrestador): Resposta {
  const r = estado.rascunho;
  const s = servicoNacional(r.codigo!)!;
  const t = r.tomador;
  const regime = regimeDo(emit);
  estado.etapa = 'confirmar';
  return {
    texto: [
      '*Confere a NFS-e?*',
      '',
      `*Serviço:* ${r.descricao}`,
      `*Código:* ${formatarCodigo(s.codigo)} · ${curto(s.descricao, 80)}`,
      t ? `*Tomador:* ${t.nome}\n${t.tipo} ${t.doc}${t.endereco?.municipio ? ` · ${t.endereco.municipio}/${t.endereco.uf}` : ''}${t.email ? ` · ${t.email}` : ''}` : '*Tomador:* não identificado',
      `*Local da prestação:* ${emit.endereco.municipio}/${emit.endereco.uf}`,
      regime === 'mei'
        ? '*Tributos:* MEI, ISS recolhido no DAS'
        : `*Tributos:* Simples Nacional, aproximadamente ${pct(p.pTotTribSN!)}; ISS calculado pelo Sistema Nacional`,
      `*Valor: ${brl(r.valor!)}*`,
      '',
      'Ambiente de *produção restrita* (homologação): sem valor fiscal.'
    ].join('\n'),
    sugestoes: ['Sim, emitir', 'Cancelar']
  };
}

async function transmitir(estado: Estado, emit: Emitente, p: DadosPrestador): Promise<Resposta[]> {
  const r = estado.rascunho;
  const regras = regrasNfseVigentes();
  const { id, numero } = reservarNfse({
    serie: regras.serie,
    tomador: r.tomador?.nome ?? 'NAO IDENTIFICADO',
    total: r.valor!,
    payload: JSON.stringify(r),
    regrasVersao: regras.versao
  });
  registrarAuditoria(id, 'transmissao_iniciada', `dps ${numero}`, 'nfse');

  let res: ResultadoNfse;
  try {
    const dps = montarDps(r, emit, p, numero);
    atualizarNfse(id, { id_dps: idDps(dps) });
    res = await emitirNfse(dps);
  } catch (e) {
    res = { status: 'erro', motivo: (e as Error).message.slice(0, 300) };
  }
  atualizarNfse(id, {
    status: res.status,
    chave: res.chave ?? null,
    numero_nfse: numeroNfse(res.xmlNfse),
    codigo: res.codigo ?? null,
    motivo: res.motivo ?? null,
    xml_dps: res.xmlDps ?? null,
    xml_nfse: res.xmlNfse ?? null
  });
  registrarAuditoria(id, `resultado_${res.status}`, `${res.codigo ?? ''} ${res.motivo ?? ''}`.trim(), 'nfse');

  salvarJson('servicos', 'chave', chaveServico(r.descricao!), { descricao: r.descricao, codigo: r.codigo, valor: r.valor });
  if (r.tomador) salvarJson('clientes', 'doc', r.tomador.doc, { ...buscarJson<DestinatarioRascunho>('clientes', 'doc', r.tomador.doc), ...r.tomador });

  const nota = cartao(obterNfse(id)!);
  if (res.status === 'autorizada') {
    kvSet(CHAVE_ESTADO, vazio());
    return [{ texto: `✅ *NFS-e${nota.numeroNota ? ` ${nota.numeroNota}` : ''} gerada pelo Sistema Nacional!*`, nota, sugestoes: ['Nova nota', 'Notas'] }];
  }
  if (res.status === 'pendente') {
    kvSet(CHAVE_ESTADO, vazio());
    return [{
      texto: `⏳ A DPS ${numero} foi enviada, mas o Sistema Nacional não respondeu com a nota. *Não vou reenviar* para não duplicar. Mande *consultar* em alguns minutos.`,
      nota, sugestoes: ['Consultar']
    }];
  }
  if (res.status === 'erro') {
    estado.etapa = 'confirmar'; // Nada chegou ao ADN: "sim" tenta de novo.
    return [{ texto: `⚠️ Não consegui transmitir: ${res.motivo}`, nota, sugestoes: ['Sim, emitir', 'Cancelar'] }];
  }

  const erros = (res.erros?.length ? res.erros : [{ codigo: res.codigo, descricao: res.motivo }]).slice(0, 3);
  const cadastral = erros.some((e) => e.codigo && CADASTRAIS_NFSE.has(e.codigo));
  estado.etapa = 'confirmar';
  return [{
    texto: [
      `❌ *O Sistema Nacional rejeitou a DPS ${numero}*`,
      ...erros.map((e) => {
        const dica = explicarNfse(e.codigo);
        const complemento = 'complemento' in e && e.complemento ? ` (${e.complemento})` : '';
        return `\nCódigo ${e.codigo ?? '?'}: ${e.descricao ?? 'sem descrição'}${complemento}${dica ? `\n${dica}` : ''}`;
      }),
      cadastral ? '\nCorrigir o rascunho não resolve este código. Mande *diagnostico* para ver o convênio do município.' : '\nCorrija o dado e responda *sim* para reenviar.'
    ].join('\n'),
    nota,
    sugestoes: cadastral ? ['Diagnostico', 'Cancelar'] : ['Sim, emitir', 'Cancelar']
  }];
}

async function consultarPendentes(): Promise<Resposta[]> {
  const pendentes = nfsePendentes();
  if (!pendentes.length) return [{ texto: 'Nenhuma NFS-e pendente.' }];
  const respostas: Resposta[] = [];
  for (const n of pendentes) {
    try {
      const c = await consultarPorDps(n.id_dps!);
      if (c.gerada) {
        atualizarNfse(n.id, { status: 'autorizada', chave: c.chave ?? null, xml_nfse: c.xmlNfse ?? null, numero_nfse: numeroNfse(c.xmlNfse), codigo: null, motivo: null });
        registrarAuditoria(n.id, 'consulta_pendente', `gerada ${c.chave}`, 'nfse');
        respostas.push({ texto: `✅ A DPS ${n.numero} virou NFS-e.`, nota: cartao(obterNfse(n.id)!) });
        continue;
      }
      // Sem nota depois de alguns minutos, a DPS nao foi processada: o numero pode ser reaproveitado.
      const minutos = (Date.now() - new Date(`${n.criado_em}Z`).getTime()) / 60000;
      if (minutos < 3) {
        respostas.push({ texto: `DPS ${n.numero}: ainda não aparece no Sistema Nacional. Tente de novo em alguns minutos.` });
        continue;
      }
      atualizarNfse(n.id, { status: 'rejeitada', codigo: '404', motivo: 'DPS nao processada pelo Sistema Nacional' });
      registrarAuditoria(n.id, 'consulta_pendente', 'nao gerada', 'nfse');
      respostas.push({ texto: `DPS ${n.numero}: não virou NFS-e no Sistema Nacional. O número volta a ficar livre; emita de novo quando quiser.` });
    } catch (e) {
      respostas.push({ texto: `DPS ${n.numero}: consulta falhou, tente de novo. ${(e as Error).message.slice(0, 120)}` });
    }
  }
  return respostas;
}

async function cancelarNota(id: number, motivo: string, emit: Emitente): Promise<Resposta[]> {
  const n = obterNfse(id);
  if (!n?.chave || n.status !== 'autorizada') return [{ texto: 'Essa nota não está mais autorizada.' }];
  try {
    const r = await cancelarNfse(n.chave, emit.cnpj, motivo);
    atualizarNfse(id, { status: 'cancelada', xml_cancelamento: r.xmlEvento || null });
    registrarAuditoria(id, 'cancelada', motivo, 'nfse');
    return [{ texto: `🚫 *NFS-e ${n.numero_nfse ?? n.numero} cancelada.*`, nota: cartao(obterNfse(id)!) }];
  } catch (e) {
    const erro = e as { erros?: { codigo?: string; descricao?: string }[]; message: string }; // CancelamentoRecusado
    const primeiro = erro.erros?.[0];
    registrarAuditoria(id, 'cancelamento_recusado', primeiro?.codigo ?? erro.message, 'nfse');
    return [{ texto: `❌ O cancelamento não foi aceito: ${primeiro ? `${primeiro.codigo} ${primeiro.descricao ?? ''}` : erro.message.slice(0, 200)}` }];
  }
}

// Indicadores do convenio (parametrizacao/swagger): 1 = sim, 0 = nao.
const INDICADORES: [string, string][] = [
  ['aderenteAmbienteNacional', 'Aderente ao ambiente nacional'],
  ['aderenteEmissorNacional', 'Aderente ao emissor nacional'],
  ['situacaoEmissaoPadraoContribuintesRFB', 'Emissão padrão liberada para contribuintes'],
  ['aderenteMAN', 'Aderente ao MAN']
];

function descreverConvenio(parametros: Record<string, unknown> | null): string[] {
  if (!parametros) return [];
  return INDICADORES.filter(([k]) => k in parametros).map(([k, rotulo]) => `${rotulo}: ${parametros[k] === 1 || parametros[k] === true ? 'sim' : 'não'}`);
}

async function responderComando(cmd: ComandoNfse, estado: Estado, emit: Emitente, p: DadosPrestador): Promise<Resposta[]> {
  switch (cmd.tipo) {
    case 'ajuda':
      return [{
        texto: [
          'Me conte o serviço como se fosse uma mensagem:',
          '',
          '_consultoria tributária 1.500,00 para 12.345.678/0001-95_',
          '',
          'Eu pergunto só o que faltar, inclusive o código da lista nacional. Outros comandos: *notas*, *status*, *empresa*, *diagnostico*, *consultar*, *cancelar nota 12*, *cancelar* (rascunho), *im 12345* e *tributos 6*.'
        ].join('\n')
      }];
    case 'cancelar':
      kvSet(CHAVE_ESTADO, vazio());
      estado.rascunho = {};
      estado.etapa = null;
      return [{ texto: 'Rascunho apagado. Nenhuma NFS-e foi enviada.', sugestoes: ['Nova nota'] }];
    case 'notas': {
      const notas = listarNfse(8);
      if (!notas.length) return [{ texto: 'Ainda não há NFS-e.' }];
      const icone: Record<string, string> = { autorizada: '✅', rejeitada: '❌', pendente: '⏳', erro: '⚠️', cancelada: '🚫' };
      return [{
        texto: ['*Últimas NFS-e*', '', ...notas.map((n) =>
          `${icone[n.status]} ${n.numero_nfse ? `Nº ${n.numero_nfse}` : `DPS ${n.numero}`} · ${brl(n.total)} · ${n.tomador}${n.codigo && n.status !== 'autorizada' ? ` · cód. ${n.codigo}` : ''}`)].join('\n')
      }];
    }
    case 'status':
    case 'diagnostico': {
      try {
        const c = await convenioMunicipio(emit.endereco.codigoMunicipio);
        const ok = c.statusHttp >= 200 && c.statusHttp < 300;
        if (cmd.tipo === 'status') {
          const respondeu = ok || Boolean(c.mensagem);
          return [{ texto: `Sistema Nacional NFS-e (produção restrita): ${respondeu ? '*respondendo*' : `*HTTP ${c.statusHttp}*`} · ${c.ms} ms` }];
        }
        return [{
          texto: [
            '*Diagnóstico no Sistema Nacional NFS-e (produção restrita)*',
            `Conexão e certificado: ${c.statusHttp === 401 || c.statusHttp === 403 ? '❌ certificado recusado' : '✅ aceitos'}`,
            `Convênio de ${emit.endereco.municipio}/${emit.endereco.uf}: ${ok ? '✅ ativo' : c.statusHttp === 404 ? '❌ não ativo' : `HTTP ${c.statusHttp}`}`,
            c.mensagem && !ok ? `_${c.mensagem}_` : '',
            ...descreverConvenio(c.parametros).map((l) => `· ${l}`),
            regimeDo(emit) === 'mei'
              ? '\nMEI emite pelo Sistema Nacional mesmo em município sem convênio.'
              : ok ? '' : '\nSem convênio ativo, ME/EPP precisa emitir no sistema da prefeitura.'
          ].filter(Boolean).join('\n')
        }];
      } catch (e) {
        return [{ texto: `Não consegui falar com o Sistema Nacional: ${(e as Error).message.slice(0, 200)}` }];
      }
    }
    case 'empresa':
      return [{
        texto: [
          `*${emit.razaoSocial}*`,
          `CNPJ ${emit.cnpj}`,
          `Regime: ${ROTULO_REGIME[regimeDo(emit)]}`,
          regimeDo(emit) === 'mei' ? '' : `Inscrição Municipal: ${p.im === undefined ? 'ainda não informada' : p.im ?? 'não tem'}`,
          regimeDo(emit) === 'mei' || p.pTotTribSN === undefined ? '' : `Tributos aproximados: ${pct(p.pTotTribSN)}`,
          `Município emissor: ${emit.endereco.municipio}/${emit.endereco.uf} (IBGE ${emit.endereco.codigoMunicipio})`
        ].filter(Boolean).join('\n')
      }];
    case 'consultar':
      return consultarPendentes();
    case 'cancelar_nota': {
      const n = nfsePorNumero(cmd.numero);
      if (!n) return [{ texto: `Não encontrei a NFS-e ${cmd.numero}.` }];
      if (n.status !== 'autorizada') return [{ texto: `A NFS-e ${cmd.numero} está ${n.status}: só nota autorizada pode ser cancelada.` }];
      estado.etapa = 'confirmar_cancelamento';
      estado.cancelar = n.id;
      return [{
        texto: `Cancelar a *NFS-e ${n.numero_nfse ?? n.numero}* de ${brl(n.total)} para ${n.tomador}?\n\nMotivo: *erro na emissão*. Responda *sim* para cancelar, ou escreva outro motivo (15 letras ou mais).`,
        sugestoes: ['Sim, cancelar', 'Não']
      }];
    }
    case 'nova':
      if (estado.etapa && estado.rascunho.descricao) return [{ texto: 'Já temos um rascunho em andamento. Vamos continuar, ou mande *cancelar*.' }];
      return [];
  }
}

async function responderEtapa(estado: Estado, texto: string, p: DadosPrestador, avisos: string[]): Promise<void> {
  const r = estado.rascunho;
  const t = r.tomador;
  switch (estado.etapa) {
    case 'im': {
      const im = /^(n[aã]o|sem|nenhuma)/i.test(texto.trim()) ? null : texto.replace(/[^\dA-Za-z]/g, '');
      if (im !== null && (im.length < 1 || im.length > 15)) {
        avisos.push('Mande só o número da Inscrição Municipal, ou responda *não tenho*.');
        return;
      }
      salvarPrestador({ ...p, im });
      Object.assign(p, { im });
      return;
    }
    case 'tributos': {
      const v = extrairPercentualSimples(`tributos ${texto}`);
      if (v === null) {
        avisos.push('Mande só o percentual, por exemplo *6* ou *15,5*.');
        return;
      }
      salvarPrestador({ ...p, pTotTribSN: v });
      Object.assign(p, { pTotTribSN: v });
      return;
    }
    case 'codigo': {
      const escolhido = texto.trim().match(/^([1-3])$/) ? estado.sugeridos?.[Number(texto.trim()) - 1] : null;
      const codigo = escolhido ?? extrairCodigoServico(texto, true);
      if (codigo) {
        definirCodigo(r, codigo, avisos);
        return;
      }
      const outros = /\p{L}{4}/u.test(texto) ? sugestoesDeCodigo(texto) : [];
      if (outros.length) estado.sugeridos = outros;
      else avisos.push('Não reconheci esse código. São 4 ou 6 dígitos, como *17.01* ou *17.01.01*, ou descreva o serviço com outras palavras.');
      return;
    }
    case 'valor':
      if (!r.valor) avisos.push('Mande o valor, por exemplo *1.500,00*.');
      return;
    case 'nome':
      if (t && texto.trim().length >= 2) t.nome = texto.trim().toUpperCase().slice(0, 150);
      return;
    case 'cep': {
      const cep = extrairCep(texto);
      if (!cep || !t) { avisos.push('CEP são 8 dígitos, por exemplo *18707-150*.'); return; }
      const e = await buscarCep(cep);
      if (!e?.codigoMunicipio) { avisos.push('Não encontrei esse CEP.'); return; }
      t.endereco = { ...e, numero: t.endereco?.numero };
      return;
    }
    case 'logradouro':
      if (t?.endereco && texto.trim().length >= 2) t.endereco = { ...t.endereco, logradouro: texto.trim().toUpperCase().slice(0, 120) };
      return;
    case 'numero':
      if (t?.endereco) t.endereco = { ...t.endereco, numero: texto.trim().toUpperCase().slice(0, 20) || 'S/N' };
      return;
    case 'bairro':
      if (t?.endereco) t.endereco = { ...t.endereco, bairro: texto.trim().toUpperCase().slice(0, 60) };
      return;
    default:
      return;
  }
}

export function mensagemInicial(): Resposta {
  return {
    texto: 'Oi! Aqui você emite *NFS-e de serviços* pelo Sistema Nacional. Como prefere começar?\n\n*Pelo chat:* me conte o serviço numa mensagem, por exemplo:\n_consultoria tributária 1.500,00 para 12.345.678/0001-95_\n\n*Pelo menu:* toque no clipe para cadastrar serviços e tomadores.\n\nAmbiente de *produção restrita*: as notas são de teste, sem valor fiscal.',
    sugestoes: ['Abrir menu', 'Diagnostico', 'Ajuda']
  };
}

export async function processar(texto: string, origemMenu = false): Promise<Resposta[]> {
  const emit = await emitente();
  if (!emit) return [{ texto: 'Não consegui carregar os dados da empresa. Verifique a internet e tente de novo.' }];
  if (regimeDo(emit) === 'nao_optante') {
    return [{ texto: 'Este emissor só emite NFS-e para *MEI* e *Simples Nacional (ME/EPP)*, e a base do CNPJ indica que a empresa não é optante.' }];
  }
  if (!emit.endereco.codigoMunicipio) return [{ texto: 'Não sei o código IBGE do município da empresa. Confira o CNPJ do emitente.' }];

  const p = prestador();
  const estado = kvGet<Estado>(CHAVE_ESTADO) ?? vazio();
  const continuar = (): Resposta[] => {
    const seguinte = estado.rascunho.descricao ? proxima(estado, emit, p) ?? resumo(estado, emit, p) : null;
    kvSet(CHAVE_ESTADO, estado);
    return seguinte ? [seguinte] : [];
  };

  const novaIm = extrairImEmitente(texto);
  if (novaIm !== undefined) {
    salvarPrestador({ ...p, im: novaIm });
    p.im = novaIm;
    return [{ texto: novaIm ? `Inscrição Municipal atualizada para *${novaIm}*.` : 'Combinado: as notas saem sem Inscrição Municipal.' }, ...continuar()];
  }
  const percentual = extrairPercentualSimples(texto);
  if (percentual !== null) {
    salvarPrestador({ ...p, pTotTribSN: percentual });
    p.pTotTribSN = percentual;
    return [{ texto: `Percentual aproximado de tributos atualizado para *${pct(percentual)}*.` }, ...continuar()];
  }

  if (estado.etapa === 'confirmar_cancelamento') {
    const id = estado.cancelar;
    estado.etapa = null;
    estado.cancelar = undefined;
    kvSet(CHAVE_ESTADO, estado);
    if (id && !ehNegacao(texto)) {
      const motivo = ehConfirmacao(texto) ? MOTIVO_PADRAO : texto.trim().slice(0, 255);
      if (motivo.length >= 15) return cancelarNota(id, motivo, emit);
      return [{ texto: 'O motivo precisa ter pelo menos 15 letras. Mande *cancelar nota* com o número de novo.' }];
    }
    return [{ texto: 'Ok, a nota continua válida.' }];
  }

  const comando = extrairComando(texto);
  if (comando) {
    const r = await responderComando(comando, estado, emit, p);
    kvSet(CHAVE_ESTADO, estado);
    if (comando.tipo !== 'nova' || r.length) return r;
    // Saudacao sem rascunho: pergunta o primeiro dado, sem tentar ler "bom dia" como servico.
    const pergunta = proxima(estado, emit, p) ?? resumo(estado, emit, p);
    kvSet(CHAVE_ESTADO, estado);
    return [pergunta];
  }

  if (estado.etapa === 'confirmar') {
    if (ehConfirmacao(texto)) {
      estado.etapa = null;
      kvSet(CHAVE_ESTADO, estado); // Evita segunda transmissao por clique duplo.
      const r = await transmitir(estado, emit, p);
      if (estado.etapa === 'confirmar') kvSet(CHAVE_ESTADO, estado);
      return r;
    }
    if (ehNegacao(texto)) {
      return [{ texto: 'Sem problema. Me diga o que mudar (ex.: *valor 1.200*, *código 17.01*, *descrição: ...*) ou mande *cancelar*.', sugestoes: ['Cancelar'] }];
    }
  }

  const avisos: string[] = [];
  const respostaDireta = !origemMenu && estado.etapa !== null && ETAPAS_DIRETAS.has(estado.etapa);
  const novoTomador = respostaDireta ? null : aplicarExtracao(texto, estado, avisos, origemMenu);
  if (!origemMenu) await responderEtapa(estado, texto, p, avisos);
  if (novoTomador) await completarTomador(novoTomador, avisos);

  const pergunta = proxima(estado, emit, p);
  const saida = pergunta ?? resumo(estado, emit, p);
  kvSet(CHAVE_ESTADO, estado);
  return [...avisos.map((a) => ({ texto: a })), saida];
}

export function limparConversa(): void {
  kvDel(CHAVE_ESTADO);
}
