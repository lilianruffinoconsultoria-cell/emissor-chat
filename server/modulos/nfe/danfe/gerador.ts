// DANFE da biblioteca com tres ajustes: cabecalho do emitente, bloco IBS/CBS e marca de homologacao.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DanfeGenerator } = require('@brasil-fiscal/nfe/dist/infra/danfe/DanfeGenerator.js');
const { parseNFeXml } = require('@brasil-fiscal/nfe/dist/infra/danfe/xml-parser.js');

// Mesmas medidas do layout original.
const M = 28;
const W = 595.28 - M * 2;
const PAGINA_H = 841.89;
const P = 3;
const F = 7;
const FS = 6;
const FL = 14;
const RH = 22;

type Reforma = {
  base: string;
  ibsUf: string;
  ibsMun: string;
  cbs: string;
  pIbsUf: string;
  pIbsMun: string;
  pCbs: string;
  cst: string;
  cClassTrib: string;
};

const valor = (xml: string, nome: string) => xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`))?.[1] ?? '';

function lerReforma(xml: string): Reforma | undefined {
  const total = xml.match(/<IBSCBSTot>[\s\S]*?<\/IBSCBSTot>/)?.[0];
  const item = xml.match(/<IBSCBS>[\s\S]*?<\/IBSCBS>/)?.[0];
  if (!total || !item) return undefined;
  return {
    base: valor(total, 'vBCIBSCBS'),
    ibsUf: valor(total, 'vIBSUF'),
    ibsMun: valor(total, 'vIBSMun'),
    cbs: valor(total, 'vCBS'),
    pIbsUf: valor(item, 'pIBSUF'),
    pIbsMun: valor(item, 'pIBSMun'),
    pCbs: valor(item, 'pCBS'),
    cst: valor(item, 'CST'),
    cClassTrib: valor(item, 'cClassTrib')
  };
}

const pct = (v: string) => `${Number(v).toFixed(2).replace('.', ',')}%`;

class DanfeAjustado extends DanfeGenerator {
  renderPage(doc: any, d: any) {
    super.renderPage(doc, d);
    if (d.homologacao) this.marcaHomologacao(doc);
  }

  /** Nome longo quebrava em duas linhas e encavalava no endereco, que tinha posicao fixa. */
  cabecalho(doc: any, d: any, y: number) {
    const h = 90;
    const c1 = W * 0.35;
    const c2 = W * 0.25;
    const c3 = W * 0.4;
    const largura = c1 - P * 2;

    this.box(doc, M, y, c1, h);
    doc.fontSize(FS).font('Helvetica').fillColor('#666666');
    doc.text('IDENTIFICACAO DO EMITENTE', M + P, y + P, { width: largura });
    doc.fillColor('#000000');

    doc.fontSize(9).font('Helvetica-Bold');
    if (doc.heightOfString(d.emitente.nome, { width: largura }) > 24) doc.fontSize(7.5);
    doc.text(d.emitente.nome, M + P, y + 14, { width: largura });
    const fimNome = doc.y;

    const fantasia = d.emitente.fantasia && d.emitente.fantasia !== d.emitente.nome ? d.emitente.fantasia : '';
    const endereco = [
      fantasia,
      d.emitente.endereco,
      d.emitente.bairro,
      `${d.emitente.cidade} - ${d.emitente.uf} - ${this.fmtCep(d.emitente.cep)}`,
      d.emitente.fone ? `Fone/Fax: ${d.emitente.fone}` : ''
    ].filter(Boolean).join('\n');
    doc.fontSize(F).font('Helvetica');
    doc.text(endereco, M + P, fimNome + 3, { width: largura });

    const x2 = M + c1;
    this.box(doc, x2, y, c2, h);
    doc.fontSize(FL).font('Helvetica-Bold');
    doc.text('DANFE', x2, y + 6, { width: c2, align: 'center' });
    doc.fontSize(FS).font('Helvetica');
    doc.text('Documento Auxiliar da Nota\nFiscal Eletronica', x2, y + 22, { width: c2, align: 'center' });
    doc.fontSize(F).font('Helvetica');
    const entrada = d.tipoOperacao === 'ENTRADA';
    doc.text('0 - ENTRADA', x2 + 8, y + 42, {});
    doc.text('1 - SAIDA', x2 + 8, y + 52, {});
    const boxY = entrada ? y + 42 : y + 52;
    doc.rect(x2 + c2 - 25, boxY - 1, 14, 10).stroke('#000000');
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(entrada ? '0' : '1', x2 + c2 - 25, boxY, { width: 14, align: 'center' });
    const numero = String(d.numero).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3');
    doc.fontSize(F).font('Helvetica-Bold');
    doc.text(`N. ${numero}`, x2, y + 66, { width: c2, align: 'center' });
    doc.text(`Serie ${String(d.serie).padStart(3, '0')}`, x2, y + 76, { width: c2, align: 'center' });
    doc.fontSize(FS).font('Helvetica');
    doc.text('Folha 1/1', x2, y + 84, { width: c2, align: 'center' });

    const x3 = M + c1 + c2;
    this.box(doc, x3, y, c3, h);
    this.renderBarcode(doc, d.chaveAcesso, x3 + 10, y + 6, c3 - 20, 28);
    doc.fontSize(FS).font('Helvetica-Bold');
    doc.text('CHAVE DE ACESSO', x3 + P, y + 38, {});
    doc.fontSize(F).font('Helvetica');
    doc.text(d.chaveAcesso.replace(/(\d{4})/g, '$1 ').trim(), x3 + P, y + 48, { width: c3 - P * 2 });
    doc.fontSize(FS).font('Helvetica');
    doc.text('Consulta de autenticidade no portal nacional da NF-e', x3 + P, y + 62, { width: c3 - P * 2 });
    doc.text('www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora', x3 + P, y + 72, { width: c3 - P * 2 });
    return y + h;
  }

  impostos(doc: any, d: any, y: number) {
    const fim = super.impostos(doc, d, y);
    return d.reforma ? this.blocoReforma(doc, d.reforma, fim + 2) : fim;
  }

  // A NT 2025.002 ainda nao publicou o layout oficial destes campos no DANFE (item 9).
  blocoReforma(doc: any, r: Reforma, y: number) {
    this.sectionTitle(doc, 'REFORMA TRIBUTARIA - IBS / CBS (INFORMATIVO, LAYOUT OFICIAL PENDENTE)', y);
    y += 10;
    const coluna = W / 6;
    this.fieldRow(doc, [['BASE DE CALCULO', r.base]], y, coluna, RH);
    const campos: [string, string][] = [
      [`IBS UF (${pct(r.pIbsUf)})`, r.ibsUf],
      [`IBS MUNICIPIO (${pct(r.pIbsMun)})`, r.ibsMun],
      [`CBS (${pct(r.pCbs)})`, r.cbs],
      ['CST IBS/CBS', r.cst],
      ['CCLASSTRIB', r.cClassTrib]
    ];
    campos.forEach(([rotulo, conteudo], i) => {
      const x = M + coluna * (i + 1);
      this.box(doc, x, y, coluna, RH);
      this.label(doc, rotulo, x + P, y + P);
      const numerico = i < 3;
      doc.fontSize(F).font('Helvetica-Bold').fillColor('#000000');
      doc.text(numerico ? this.fmtNum(conteudo, 2) : conteudo, x + P, y + 12, { width: coluna - P * 2, align: 'right' });
    });
    return y + RH;
  }

  marcaHomologacao(doc: any) {
    const x = M + W / 2;
    const y = PAGINA_H / 2;
    doc.save();
    doc.rotate(-38, { origin: [x, y] });
    doc.fillColor('#b00000').opacity(0.13).font('Helvetica-Bold');
    doc.fontSize(46).text('SEM VALOR FISCAL', x - 300, y - 40, { width: 600, align: 'center', lineBreak: false });
    doc.fontSize(20).text('AMBIENTE DE HOMOLOGACAO', x - 300, y + 14, { width: 600, align: 'center', lineBreak: false });
    doc.restore();
    doc.fillColor('#000000').opacity(1);
  }
}

export async function gerarDanfe(xmlProtocolado: string): Promise<Buffer> {
  const dados = parseNFeXml(xmlProtocolado);
  return new DanfeAjustado().generate({
    ...dados,
    reforma: lerReforma(xmlProtocolado),
    homologacao: valor(xmlProtocolado, 'tpAmb') === '2'
  });
}
