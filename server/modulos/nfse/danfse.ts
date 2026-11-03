// DANFSe gerado a partir do XML da NFS-e. Desde 03/08/2026 o ADN nao gera mais o PDF (NT 008 v1.02):
// cabe ao emissor. Segue os itens obrigatorios da NT 008 (pagina unica A4 retrato, QR Code de consulta
// publica com o texto de autenticidade, aviso de homologacao); a disposicao dos quadros e simplificada.
// O documento legal e o XML; este PDF so o representa.
import { createRequire } from 'node:module';
import { formatarCodigo } from './servicos.ts';

const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode') as { toBuffer(texto: string, opcoes: object): Promise<Buffer> };

export const urlConsultaPublica = (chave: string) => `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chave}`;
const CM = 595.28 / 21; // pontos por centimetro no A4

const M = 36;
const W = 595.28 - M * 2;

const bloco = (xml: string, nome: string) => xml.match(new RegExp(`<${nome}[\\s>][\\s\\S]*?</${nome}>`))?.[0] ?? '';
const valor = (xml: string, nome: string) =>
  xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`))?.[1]?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') ?? '';

const brl = (v: string) => (v ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-');
const doc = (d: string) =>
  d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
    : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d || '-';
const data = (iso: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');

export type DadosDanfse = {
  chave: string;
  numero: string;
  emissao: string;
  competencia: string;
  homologacao: boolean;
  cancelada: boolean;
  emitente: { nome: string; doc: string; im: string; municipio: string };
  tomador: { nome: string; doc: string; email: string } | null;
  servico: { codigo: string; nacional: string; descricao: string; local: string };
  valores: { servico: string; iss: string; aliquota: string; liquido: string };
};

export function lerNfse(xml: string, chave: string, cancelada = false): DadosDanfse {
  const inf = bloco(xml, 'infNFSe');
  const emit = bloco(inf, 'emit');
  const dps = bloco(inf, 'infDPS');
  const toma = bloco(dps, 'toma');
  const valores = bloco(inf.replace(dps, ''), 'valores');
  return {
    chave,
    numero: valor(inf, 'nNFSe'),
    emissao: valor(inf, 'dhProc') || valor(dps, 'dhEmi'),
    competencia: valor(dps, 'dCompet'),
    homologacao: valor(dps, 'tpAmb') === '2' || valor(inf, 'ambGer') === '2',
    cancelada,
    emitente: {
      nome: valor(emit, 'xNome'),
      doc: valor(emit, 'CNPJ') || valor(emit, 'CPF'),
      im: valor(emit, 'IM'),
      municipio: valor(inf, 'xLocEmi')
    },
    tomador: toma ? { nome: valor(toma, 'xNome'), doc: valor(toma, 'CNPJ') || valor(toma, 'CPF'), email: valor(toma, 'email') } : null,
    servico: {
      codigo: valor(dps, 'cTribNac'),
      nacional: valor(inf, 'xTribNac'),
      descricao: valor(dps, 'xDescServ'),
      local: valor(inf, 'xLocPrestacao')
    },
    valores: {
      servico: valor(dps, 'vServ'),
      iss: valor(valores, 'vISSQN'),
      aliquota: valor(valores, 'pAliqAplic'),
      liquido: valor(valores, 'vLiq')
    }
  };
}

export async function gerarDanfse(d: DadosDanfse): Promise<Buffer> {
  const qr = await QRCode.toBuffer(urlConsultaPublica(d.chave), { type: 'png', margin: 0, width: 240, errorCorrectionLevel: 'M' });
  const pdf = new PDFDocument({ size: 'A4', margin: M, info: { Title: `DANFSe ${d.numero}` } });
  const partes: Buffer[] = [];
  pdf.on('data', (c: Buffer) => partes.push(c));
  const pronto = new Promise<Buffer>((resolve) => pdf.on('end', () => resolve(Buffer.concat(partes))));

  let y = M;
  const titulo = (t: string) => {
    y += 6;
    pdf.rect(M, y, W, 16).fill('#eeeeee');
    pdf.fill('#000').font('Helvetica-Bold').fontSize(8).text(t.toUpperCase(), M + 6, y + 4.5);
    y += 20;
  };
  const campo = (rotulo: string, conteudo: string, x: number, largura: number) => {
    pdf.font('Helvetica').fontSize(6.5).fill('#555').text(rotulo, x, y, { width: largura });
    pdf.font('Helvetica').fontSize(9).fill('#000').text(conteudo || '-', x, y + 8, { width: largura });
  };
  const linha = (campos: [string, string, number][]) => {
    let x = M;
    const altura = Math.max(...campos.map(([, c, f]) => pdf.font('Helvetica').fontSize(9).heightOfString(c || '-', { width: W * f - 8 })));
    for (const [r, c, f] of campos) {
      campo(r, c, x + 4, W * f - 8);
      x += W * f;
    }
    y += altura + 14;
  };

  // QR Code na posicao da NT 008 (X 17,48 cm, Y 1,67 cm, minimo 1,52 cm), com o texto de autenticidade abaixo.
  const qrX = 17.48 * CM;
  const qrY = 1.67 * CM;
  const qrLado = 2 * CM;
  pdf.image(qr, qrX, qrY, { width: qrLado });
  // Legenda em 3 linhas de 6 pt, centrada sob o QR.
  const legendaLargura = 124;
  const legendaX = qrX + qrLado / 2 - legendaLargura / 2;
  pdf.font('Helvetica').fontSize(6).fill('#000').text(
    'A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e',
    legendaX, qrY + qrLado + 3, { width: legendaLargura, align: 'center' }
  );
  const fimQr = pdf.y;
  const largura = qrX - M - 12;
  pdf.font('Helvetica-Bold').fontSize(13).text('DANFSe', M, y);
  pdf.font('Helvetica').fontSize(8).text('Documento Auxiliar da NFS-e', M, y + 16);
  pdf.font('Helvetica-Bold').fontSize(13).text(`NFS-e nº ${d.numero || '-'}`, M, y, { width: largura, align: 'right' });
  if (d.homologacao) {
    pdf.font('Helvetica-Bold').fontSize(10).fill('#c00').text('NFS-e SEM VALIDADE JURÍDICA', M, y + 30, { width: largura });
    pdf.fill('#000');
  }
  y = Math.max(y + 48, fimQr + 8);
  linha([['Chave de acesso', d.chave.replace(/(\d{5})(?=\d)/g, '$1 '), 0.6], ['Emissão', data(d.emissao), 0.22], ['Competência', d.competencia.split('-').reverse().join('/'), 0.18]]);

  titulo('Prestador');
  linha([['Nome / razão social', d.emitente.nome, 0.6], ['CNPJ / CPF', doc(d.emitente.doc), 0.25], ['Inscrição municipal', d.emitente.im, 0.15]]);
  linha([['Município emissor', d.emitente.municipio, 1]]);

  titulo('Tomador');
  if (d.tomador) {
    linha([['Nome / razão social', d.tomador.nome, 0.6], ['CNPJ / CPF', doc(d.tomador.doc), 0.25], ['E-mail', d.tomador.email, 0.15]]);
  } else {
    linha([['Tomador', 'Não identificado', 1]]);
  }

  titulo('Serviço');
  linha([['Código de tributação nacional', `${d.servico.codigo ? formatarCodigo(d.servico.codigo) : '-'} ${d.servico.nacional}`, 0.7], ['Local da prestação', d.servico.local, 0.3]]);
  linha([['Descrição', d.servico.descricao, 1]]);

  titulo('Valores');
  linha([
    ['Valor do serviço', brl(d.valores.servico), 0.25],
    ['Alíquota ISS', d.valores.aliquota ? `${d.valores.aliquota.replace('.', ',')}%` : '-', 0.25],
    ['Valor do ISS', brl(d.valores.iss), 0.25],
    ['Valor líquido', brl(d.valores.liquido || d.valores.servico), 0.25]
  ]);

  y += 8;
  pdf.font('Helvetica').fontSize(7).fill('#555').text(
    `Consulta pública: ${urlConsultaPublica(d.chave)}. O XML da NFS-e é o documento fiscal; este PDF é só uma representação.`,
    M, y, { width: W }
  );

  const marca = d.cancelada ? 'CANCELADA' : d.homologacao ? 'SEM VALOR FISCAL' : '';
  if (marca) {
    pdf.save().rotate(-35, { origin: [297, 420] }).font('Helvetica-Bold').fontSize(54).fillOpacity(0.12).fill('#c00')
      .text(marca, 0, 400, { width: 595, align: 'center', lineBreak: false }).restore();
  }
  pdf.end();
  return pronto;
}
