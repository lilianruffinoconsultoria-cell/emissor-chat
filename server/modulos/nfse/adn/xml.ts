// Ajustes na DPS gerada pela biblioteca, sempre antes da assinatura.
import { tag, tagGroup } from '@brasil-fiscal/core';
import { DefaultNFSeXmlBuilder, type DPSProps } from '@brasil-fiscal/nfse';
import type { DpsMontada, EnderecoTomador } from '../motor.ts';

function endereco(e: EnderecoTomador): string {
  return tagGroup(
    'end',
    tagGroup('endNac', tag('cMun', e.cMun) + tag('CEP', e.CEP)) +
      tag('xLgr', e.xLgr) + tag('nro', e.nro) + tag('xCpl', e.xCpl) + tag('xBairro', e.xBairro)
  );
}

export type OpcoesDps = { leiaute: string; finNFSeNaDps: boolean };

/** O XSD pede o endereco logo depois do nome do tomador: CNPJ|CPF, IM, xNome, end, fone, email. */
export function ajustarDps(xml: string, dps: DpsMontada, { leiaute, finNFSeNaDps }: OpcoesDps): string {
  let ajustado = xml.replace(/(<DPS [^>]*versao=")[^"]*"/, `$1${leiaute}"`);
  if (finNFSeNaDps) ajustado = ajustado.replace('</tpEmit>', '</tpEmit><finNFSe>0</finNFSe>');
  if (dps.tomadorEndereco) {
    ajustado = ajustado.replace(/(<toma>[\s\S]*?<\/xNome>)/, `$1${endereco(dps.tomadorEndereco)}`);
  }
  return ajustado;
}

export class XmlDps extends DefaultNFSeXmlBuilder {
  constructor(private readonly opcoes: OpcoesDps) {
    super();
  }
  override build(dps: DPSProps): string {
    return ajustarDps(super.build(dps), dps as DpsMontada, this.opcoes);
  }
}
