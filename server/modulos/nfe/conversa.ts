// Conversa da NF-e (mercadorias): mantem o rascunho, pergunta o que falta e dispara a emissao.
import { buscarCep, buscarPorCnpj } from '../../cadastros.ts';
import { ehConfirmacao, ehNegacao, extrairCep, extrairDocumento, extrairNomeCliente } from '../../chat/parser.ts';
import { emitente, salvarEmitente } from '../../comum/emitente.ts';
import { config } from '../../config.ts';
import {
  atualizarNota,
  buscarJson,
  kvDel,
  kvGet,
  kvSet,
  listarNotas,
  notasPendentes,
  obterNota,
  registrarAuditoria,
  reservarNota,
  salvarJson
} from '../../db.ts';
import type { CartaoNota, Resposta } from '../tipos.ts';
import { CADASTRAIS, explicar } from './explicacoes.ts';
import { cfopDa, montarNFe, totalItem, totalNota, tributosReforma, type DestinatarioRascunho, type Emitente, type Rascunho } from './fiscal/motor.ts';
import { regrasVigentes } from './fiscal/regras.ts';
import { extrairCfop, extrairComando, extrairIeEmitente, extrairItens, extrairNcm, extrairPagamento } from './parser.ts';
import { buscarProduto, chaveProduto, itensDoCatalogo } from './produtos.ts';
import { consultar, consultarCadastro, emitir, statusServico, type ResultadoEmissao } from './sefaz/adapter.ts';

type Etapa =
  | 'ie_emitente' | 'item' | 'ncm' | 'documento' | 'nome' | 'ie_cliente'
  | 'cep' | 'logradouro' | 'numero' | 'bairro' | 'pagamento' | 'confirmar';

type Estado = { rascunho: Rascunho; etapa: Etapa | null };

const ETAPAS_DIRETAS = new Set<Etapa>(['ie_emitente', 'ncm', 'nome', 'ie_cliente', 'cep', 'logradouro', 'numero', 'bairro']);
const SERIE = 1;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const CHAVE_ESTADO = 'conversa';
const vazio = (): Estado => ({ rascunho: { itens: [] }, etapa: null });

function aplicarExtracao(texto: string, estado: Estado, avisos: string[]): DestinatarioRascunho | null {
  const r = estado.rascunho;
  const doc = extrairDocumento(texto);
  let novoDest: DestinatarioRascunho | null = null;
  if (doc) {
    if (!doc.valido) avisos.push(`Esse ${doc.tipo} *${doc.trecho}* não é válido (dígito verificador não confere).`);
    else if (r.destinatario?.doc !== doc.doc) {
      novoDest = { tipo: doc.tipo, doc: doc.doc, nome: extrairNomeCliente(texto) ?? undefined };
      r.destinatario = novoDest;
    }
  }
  const itens = extrairItens(texto);
  for (const item of itens) {
    const conhecido = buscarProduto(item.descricao);
    if (conhecido) item.ncm = conhecido.ncm;
    r.itens.push(item);
  }
  if (!itens.length) r.itens.push(...itensDoCatalogo(texto));
  const ncm = extrairNcm(texto);
  if (ncm && estado.etapa !== 'ncm') {
    const alvo = r.itens.find((i) => !i.ncm) ?? r.itens.at(-1);
    if (alvo) alvo.ncm = ncm;
  }
  const pagamento = extrairPagamento(texto);
  if (pagamento) r.pagamento = pagamento;
  const cfop = extrairCfop(texto);
  if (cfop) r.cfop = cfop;
  return novoDest;
}

async function completarDestinatario(d: DestinatarioRascunho, avisos: string[]): Promise<void> {
  const salvo = buscarJson<DestinatarioRascunho>('clientes', 'doc', d.doc);
  if (salvo?.endereco?.logradouro) {
    Object.assign(d, { ...salvo, nome: salvo.nome ?? d.nome });
    return;
  }
  if (d.tipo !== 'CNPJ') return;
  const e = await buscarPorCnpj(d.doc);
  if (!e) {
    avisos.push('Não consegui buscar esse CNPJ, vou pedir os dados aqui.');
    return;
  }
  d.nome = e.nome ?? d.nome;
  d.endereco = e.endereco;
  if (e.ie) d.ie = e.ie;
  avisos.push(`Encontrei: *${e.nome}* (${e.endereco?.municipio}/${e.endereco?.uf})${e.situacao ? `, situação ${e.situacao}` : ''}.`);
}

function proxima(estado: Estado, emit: Emitente): Resposta | null {
  const r = estado.rascunho;
  const definir = (etapa: Etapa, texto: string, sugestoes?: string[]): Resposta => {
    estado.etapa = etapa;
    return { texto, sugestoes };
  };
  if (!emit.ie) {
    return definir('ie_emitente', 'Antes da primeira nota: qual é a *Inscrição Estadual* da sua empresa? Mande só os números. Se não tiver, responda *isento*.', ['isento']);
  }
  if (!r.itens.length) {
    return definir('item', 'O que você vendeu? Exemplo: *2 caixas de parafuso a 15,50*', ['Abrir menu']);
  }
  const semNcm = r.itens.find((i) => !i.ncm);
  if (semNcm) return definir('ncm', `Qual o *NCM* de *${semNcm.descricao}*? São 8 dígitos. Depois eu guardo para as próximas notas.`);
  const d = r.destinatario;
  if (!d) return definir('documento', 'Para quem é a nota? Mande o *CPF ou CNPJ* do cliente.', ['Abrir menu']);
  if (!d.nome) return definir('nome', 'Qual o *nome* do cliente?');
  if (d.tipo === 'CNPJ' && d.ie === undefined) {
    return definir('ie_cliente', 'Esse cliente tem *Inscrição Estadual*? Mande o número ou responda *não*.', ['não']);
  }
  if (!d.endereco?.codigoMunicipio) return definir('cep', 'Qual o *CEP* do cliente?');
  if (!d.endereco.logradouro) return definir('logradouro', 'Qual a *rua* do cliente?');
  if (!d.endereco.numero) return definir('numero', 'Qual o *número* do endereço?', ['S/N']);
  if (!d.endereco.bairro) return definir('bairro', 'Qual o *bairro*?');
  if (!r.pagamento) return definir('pagamento', 'Como foi o *pagamento*?', ['PIX', 'Dinheiro', 'Boleto', 'Cartão de crédito']);
  return null;
}

function resumo(estado: Estado, emit: Emitente): Resposta {
  const r = estado.rascunho;
  const d = r.destinatario!;
  estado.etapa = 'confirmar';
  const reforma = tributosReforma(r);
  const linhas = r.itens.map(
    (i, n) => `${n + 1}. ${i.quantidade} ${i.unidade} ${i.descricao}\n    ${brl(i.valorUnitario!)} = *${brl(totalItem(i))}* · NCM ${i.ncm}`
  );
  return {
    texto: [
      '*Confere a nota?*',
      '',
      ...linhas,
      '',
      `*Cliente:* ${d.nome}`,
      `${d.tipo} ${d.doc} · ${d.endereco?.municipio}/${d.endereco?.uf}`,
      `*Pagamento:* ${r.pagamento!.nome}`,
      `*CFOP:* ${cfopDa(r, emit)}`,
      `*Total: ${brl(totalNota(r))}*`,
      `*IBS/CBS:* IBS ${brl(reforma.ibs)} · CBS ${brl(reforma.cbs)} (informativo, fora do total)`,
      '',
      'Ambiente de *homologação*: sem valor fiscal.'
    ].join('\n'),
    sugestoes: ['Sim, emitir', 'Cancelar']
  };
}

async function transmitir(estado: Estado, emit: Emitente): Promise<Resposta[]> {
  const r = estado.rascunho;
  const regras = regrasVigentes();
  const { id, numero } = reservarNota({
    serie: SERIE,
    destinatario: r.destinatario!.nome!,
    total: totalNota(r),
    payload: JSON.stringify(r),
    regrasVersao: regras.versao
  });
  registrarAuditoria(id, 'transmissao_iniciada', `numero ${numero}`);

  let res: ResultadoEmissao;
  try {
    res = await emitir(montarNFe(r, emit, numero, SERIE, regras), emit.crt);
  } catch (e) {
    res = { status: 'erro', xMotivo: (e as Error).message.slice(0, 300) };
  }
  atualizarNota(id, {
    status: res.status,
    chave: res.chave ?? null,
    protocolo: res.protocolo ?? null,
    cstat: res.cStat ?? null,
    xmotivo: res.xMotivo ?? null,
    xml_enviado: res.xmlEnviado ?? null,
    xml_protocolado: res.xmlProtocolado ?? null
  });
  registrarAuditoria(id, `resultado_${res.status}`, `${res.cStat ?? ''} ${res.xMotivo ?? ''}`.trim());

  for (const item of r.itens) {
    const chave = chaveProduto(item.descricao);
    salvarJson('produtos', 'chave', chave, {
      ...buscarProduto(item.descricao),
      descricao: chave,
      ncm: item.ncm,
      unidade: item.unidade,
      valorUnitario: item.valorUnitario
    });
  }
  salvarJson('clientes', 'doc', r.destinatario!.doc, r.destinatario);

  const nota: CartaoNota = {
    modelo: 'nfe', id, numero, serie: SERIE, status: res.status, total: totalNota(r),
    chave: res.chave, protocolo: res.protocolo, cStat: res.cStat, xMotivo: res.xMotivo
  };

  if (res.status === 'autorizada') {
    kvSet(CHAVE_ESTADO, vazio());
    return [{ texto: `✅ *Nota ${numero} autorizada pela SEFAZ!*`, nota, sugestoes: ['Nova nota', 'Notas'] }];
  }
  if (res.status === 'pendente') {
    kvSet(CHAVE_ESTADO, vazio());
    return [{
      texto: `⏳ A nota ${numero} foi enviada, mas a SEFAZ não respondeu a tempo. *Não vou reenviar* para não duplicar. Mande *consultar* em alguns minutos.`,
      nota, sugestoes: ['Consultar']
    }];
  }
  if (res.status === 'erro') {
    estado.etapa = 'confirmar'; // Nada chegou a SEFAZ: "sim" tenta de novo.
    return [{ texto: `⚠️ Não consegui transmitir: ${res.xMotivo}`, nota, sugestoes: ['Sim, emitir', 'Cancelar'] }];
  }

  const explicacao = explicar(res.cStat);
  const cadastral = res.cStat ? CADASTRAIS.has(res.cStat) : false;
  estado.etapa = 'confirmar';
  return [{
    texto: [
      `❌ *SEFAZ rejeitou a nota ${numero}*`,
      `Código ${res.cStat}: ${res.xMotivo}`,
      explicacao ? `\n${explicacao}` : '',
      res.cStat === '209' ? '\nSe você tem a IE certa, mande *ie 123456789* e depois *sim*. Sem IE válida a SEFAZ não autoriza a nota.' :
      cadastral ? '\nCorrigir o rascunho não resolve este código. Mande *diagnostico* para ver a situação cadastral.' : '\nCorrija o dado e responda *sim* para reenviar.'
    ].filter(Boolean).join('\n'),
    nota,
    sugestoes: cadastral ? ['Diagnostico', 'Cancelar'] : ['Sim, emitir', 'Cancelar']
  }];
}

async function responderComando(cmd: NonNullable<ReturnType<typeof extrairComando>>, estado: Estado, emit: Emitente): Promise<Resposta[]> {
  switch (cmd) {
    case 'ajuda':
      return [{
        texto: [
          'Me conte a venda como se fosse uma mensagem:',
          '',
          '_2 caixas de parafuso a 15,50 para 12.345.678/0001-95 no pix_',
          '',
          'Eu pergunto só o que faltar. Outros comandos: *notas*, *status*, *empresa*, *diagnostico*, *consultar*, *cancelar* e *ie 123456789* para trocar a Inscrição Estadual.'
        ].join('\n')
      }];
    case 'cancelar':
      kvSet(CHAVE_ESTADO, vazio());
      estado.rascunho = { itens: [] };
      estado.etapa = null;
      return [{ texto: 'Rascunho apagado. Nenhuma nota foi enviada.', sugestoes: ['Nova nota'] }];
    case 'notas': {
      const notas = listarNotas(8);
      if (!notas.length) return [{ texto: 'Ainda não há notas.' }];
      const icone: Record<string, string> = { autorizada: '✅', rejeitada: '❌', pendente: '⏳', erro: '⚠️' };
      return [{
        texto: ['*Últimas notas*', '', ...notas.map((n) => `${icone[n.status]} Nº ${n.numero} · ${brl(n.total)} · ${n.destinatario}${n.cstat ? ` · cód. ${n.cstat}` : ''}`)].join('\n')
      }];
    }
    case 'status': {
      try {
        const s = await statusServico();
        return [{ texto: `SEFAZ-${config.uf} (homologação): *${s.xMotivo}* · código ${s.cStat} · ${s.ms} ms` }];
      } catch (e) {
        return [{ texto: `Não consegui falar com a SEFAZ: ${(e as Error).message.slice(0, 200)}` }];
      }
    }
    case 'empresa':
      return [{
        texto: [
          `*${emit.razaoSocial}*`,
          `CNPJ ${emit.cnpj}`,
          `IE: ${emit.ie ?? 'não informada'}`,
          `Regime: ${emit.crt === 4 ? 'MEI' : 'Simples Nacional'} (CRT ${emit.crt})`,
          `${emit.endereco.municipio}/${emit.endereco.uf}`
        ].join('\n')
      }];
    case 'diagnostico': {
      try {
        const [s, c] = await Promise.all([statusServico(), consultarCadastro(emit.cnpj)]);
        const habilitado = c.cStat === '111' || c.cStat === '112';
        return [{
          texto: [
            '*Diagnóstico na SEFAZ-SP (homologação)*',
            `Conexão e certificado: ✅ ${s.xMotivo}`,
            `Cadastro: ${habilitado ? '✅' : '❌'} ${c.xMotivo} (cód. ${c.cStat})`,
            c.ie ? `IE na SEFAZ: ${c.ie}` : '',
            explicar(c.cStat) ?? ''
          ].filter(Boolean).join('\n')
        }];
      } catch (e) {
        return [{ texto: `Não consegui consultar: ${(e as Error).message.slice(0, 200)}` }];
      }
    }
    case 'consultar': {
      const pendentes = notasPendentes();
      if (!pendentes.length) return [{ texto: 'Nenhuma nota pendente.' }];
      const respostas: Resposta[] = [];
      for (const n of pendentes) {
        try {
          const c = await consultar(n.chave!);
          const autorizada = c.codigoStatus === '100';
          const naoEncontrada = c.codigoStatus === '217';
          atualizarNota(n.id, {
            status: autorizada ? 'autorizada' : naoEncontrada ? 'rejeitada' : 'pendente',
            protocolo: c.protocolo ?? null,
            cstat: c.codigoStatus,
            xmotivo: c.motivo
          });
          registrarAuditoria(n.id, 'consulta_pendente', `${c.codigoStatus} ${c.motivo}`);
          respostas.push({ texto: `Nota ${n.numero}: ${c.motivo} (cód. ${c.codigoStatus})` });
        } catch (e) {
          respostas.push({ texto: `Nota ${n.numero}: consulta falhou, tente de novo. ${(e as Error).message.slice(0, 120)}` });
        }
      }
      return respostas;
    }
    case 'nova':
      if (estado.etapa && estado.rascunho.itens.length) return [{ texto: 'Já temos um rascunho em andamento. Vamos continuar, ou mande *cancelar*.' }];
      return [];
  }
}

function responderEtapa(estado: Estado, texto: string, emit: Emitente, avisos: string[]): Promise<void> | void {
  const r = estado.rascunho;
  const d = r.destinatario;
  switch (estado.etapa) {
    case 'ie_emitente': {
      const ie = /isent/i.test(texto) ? 'ISENTO' : texto.replace(/\D/g, '');
      if (ie !== 'ISENTO' && (ie.length < 2 || ie.length > 14)) {
        avisos.push('IE precisa ter entre 2 e 14 dígitos, ou responda *isento*.');
        return;
      }
      emit.ie = ie;
      salvarEmitente(emit);
      return;
    }
    case 'ncm': {
      const m = extrairNcm(`ncm ${texto}`);
      const alvo = r.itens.find((i) => !i.ncm);
      if (m && alvo) alvo.ncm = m;
      else avisos.push('NCM são 8 dígitos, por exemplo *7318.15.00*.');
      return;
    }
    case 'nome':
      if (d && texto.trim().length >= 2) d.nome = texto.trim().toUpperCase().slice(0, 60);
      return;
    case 'ie_cliente':
      if (d) {
        const so = texto.replace(/\D/g, '');
        if (ehNegacao(texto)) d.ie = null;
        else if (so.length >= 2 && so.length <= 14) d.ie = so;
      }
      return;
    case 'cep':
      return (async () => {
        const cep = extrairCep(texto);
        if (!cep || !d) { avisos.push('CEP são 8 dígitos, por exemplo *18707-150*.'); return; }
        const e = await buscarCep(cep);
        if (!e?.codigoMunicipio) { avisos.push('Não encontrei esse CEP.'); return; }
        d.endereco = { ...e, numero: d.endereco?.numero };
      })();
    case 'logradouro':
      if (d?.endereco && texto.trim().length >= 2) d.endereco = { ...d.endereco, logradouro: texto.trim().toUpperCase().slice(0, 60) };
      return;
    case 'numero':
      if (d?.endereco) d.endereco = { ...d.endereco, numero: texto.trim().toUpperCase().slice(0, 20) || 'S/N' };
      return;
    case 'bairro':
      if (d?.endereco) d.endereco = { ...d.endereco, bairro: texto.trim().slice(0, 60) };
      return;
    default:
      return;
  }
}

export function mensagemInicial(): Resposta {
  return {
    texto: 'Oi! Aqui você emite *NF-e de mercadorias*. Como prefere começar?\n\n*Pelo chat:* me conte a venda numa mensagem, por exemplo:\n_2 caixas de parafuso a 15,50 para 12.345.678/0001-95 no pix_\n\n*Pelo menu:* toque no clipe para cadastrar produtos e destinatários.\n\nAmbiente de *homologação*: as notas são de teste, sem valor fiscal.',
    sugestoes: ['Abrir menu', 'Diagnostico', 'Ajuda']
  };
}

export async function processar(texto: string, origemMenu = false): Promise<Resposta[]> {
  const emit = await emitente();
  if (!emit) return [{ texto: 'Não consegui carregar os dados da empresa. Verifique a internet e tente de novo.' }];

  const estado = kvGet<Estado>(CHAVE_ESTADO) ?? vazio();

  const novaIe = extrairIeEmitente(texto);
  if (novaIe) {
    emit.ie = novaIe;
    salvarEmitente(emit);
    const emAndamento = estado.rascunho.itens.length > 0;
    const seguinte = emAndamento ? proxima(estado, emit) ?? resumo(estado, emit) : null;
    kvSet(CHAVE_ESTADO, estado);
    return [{ texto: `Inscrição Estadual atualizada para *${novaIe}*.` }, ...(seguinte ? [seguinte] : [])];
  }

  const comando = extrairComando(texto);
  if (comando) {
    const r = await responderComando(comando, estado, emit);
    if (comando !== 'nova' || r.length) {
      kvSet(CHAVE_ESTADO, estado);
      if (comando !== 'nova') return r;
    }
    if (r.length) return r;
  }

  if (estado.etapa === 'confirmar') {
    if (ehConfirmacao(texto)) {
      estado.etapa = null;
      kvSet(CHAVE_ESTADO, estado); // Evita segunda transmissao por clique duplo.
      const r = await transmitir(estado, emit);
      if (estado.etapa === 'confirmar') kvSet(CHAVE_ESTADO, estado);
      return r;
    }
    if (ehNegacao(texto)) {
      return [{ texto: 'Sem problema. Me diga o que mudar (ex.: *ncm 7318.15.00*, *pix*, *cfop 5101*) ou mande *cancelar*.', sugestoes: ['Cancelar'] }];
    }
  }

  const avisos: string[] = [];
  // Nessas etapas a resposta e um dado isolado: digitos de IE ou CEP nao podem virar CPF.
  // Quem usa o menu nao esta respondendo a pergunta pendente: o dado sempre entra pela extracao.
  const respostaDireta = !origemMenu && estado.etapa !== null && ETAPAS_DIRETAS.has(estado.etapa);
  const novoDest = respostaDireta ? null : aplicarExtracao(texto, estado, avisos);
  if (!origemMenu) await responderEtapa(estado, texto, emit, avisos);
  if (novoDest) await completarDestinatario(novoDest, avisos);

  const pergunta = proxima(estado, emit);
  const saida = pergunta ?? resumo(estado, emit);
  kvSet(CHAVE_ESTADO, estado);
  return [...avisos.map((a) => ({ texto: a })), saida];
}

export function limparConversa(): void {
  kvDel(CHAVE_ESTADO);
}

export { obterNota };
