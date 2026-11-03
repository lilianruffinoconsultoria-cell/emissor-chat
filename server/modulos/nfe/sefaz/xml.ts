// Ajustes finais no XML, sempre antes da assinatura.
export type Crt = 1 | 4;

const fmt = (centavos: number) => (centavos / 100).toFixed(2);

function somaItens(dets: string[], nome: string): number {
  const re = new RegExp(`<${nome}>([\\d.]+)</${nome}>`);
  return dets.reduce((soma, det) => soma + Math.round(Number(det.match(re)?.[1] ?? 0) * 100), 0);
}

const CREDITO_ZERADO = '<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus>';

/** O leiaute atual exige vIBS no item; a versao publicada da biblioteca ainda nao gera. */
function completarItensReforma(xml: string): string {
  return xml.replace(/<det [\s\S]*?<\/det>/g, (det) => {
    const uf = somaItens([det], 'vIBSUF');
    const mun = somaItens([det], 'vIBSMun');
    return det.replace('</gIBSMun><gCBS>', `</gIBSMun><vIBS>${fmt(uf + mun)}</vIBS><gCBS>`);
  });
}

/** O total precisa ser a soma dos itens arredondados; a biblioteca soma antes de arredondar. */
function corrigirTotaisReforma(xml: string): string {
  const bloco = xml.match(/<IBSCBSTot>[\s\S]*?<\/IBSCBSTot>/)?.[0];
  if (!bloco) return xml;
  const dets = xml.match(/<det [\s\S]*?<\/det>/g) ?? [];
  const uf = somaItens(dets, 'vIBSUF');
  const mun = somaItens(dets, 'vIBSMun');
  const cbs = somaItens(dets, 'vCBS');
  const novo = bloco
    .replace(/<vIBSUF>[^<]*<\/vIBSUF>/, `<vIBSUF>${fmt(uf)}</vIBSUF>`)
    .replace(/<vIBSMun>[^<]*<\/vIBSMun>/, `<vIBSMun>${fmt(mun)}</vIBSMun>`)
    .replace(/<vIBS>[^<]*<\/vIBS>/, `<vIBS>${fmt(uf + mun)}</vIBS>${CREDITO_ZERADO}`)
    .replace(/<vCBS>[^<]*<\/vCBS>/, `<vCBS>${fmt(cbs)}</vCBS>${CREDITO_ZERADO}`);
  return xml.replace(bloco, novo);
}

export function ajustarXml(xml: string, crt: Crt): string {
  return corrigirTotaisReforma(completarItensReforma(xml.replace('<CRT>1</CRT>', `<CRT>${crt}</CRT>`)));
}
