// Le o certificado A1 em memoria, sem depender do openssl instalado nem expor a senha em linha de comando.
import forge from 'node-forge';
import type { CertificateData, CertificateProvider } from '@brasil-fiscal/nfe';

export class CertificadoA1 implements CertificateProvider {
  private cache?: CertificateData;

  constructor(
    private readonly pfx: Buffer,
    private readonly senha: string
  ) {}

  async load(): Promise<CertificateData> {
    if (this.cache) {
      if (this.cache.notAfter < new Date()) throw new Error('Certificado digital vencido.');
      return this.cache;
    }
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(this.pfx.toString('binary')));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, this.senha);

    const bagsChave = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
    const chave = bagsChave?.[0]?.key as forge.pki.rsa.PrivateKey | undefined;
    if (!chave) throw new Error('Chave privada nao encontrada no certificado.');

    const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
      .map((b) => b.cert)
      .filter((c): c is forge.pki.Certificate => Boolean(c));
    // O .pfx pode trazer a cadeia inteira: o certificado do titular e o que combina com a chave.
    const titular = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(chave.n));
    if (!titular) throw new Error('Certificado do titular nao encontrado no arquivo.');

    const notAfter = titular.validity.notAfter;
    if (notAfter < new Date()) throw new Error(`Certificado digital vencido em ${notAfter.toISOString()}.`);

    this.cache = {
      pfx: this.pfx,
      password: this.senha,
      notAfter,
      privateKey: forge.pki.privateKeyToPem(chave),
      certPem: forge.pki.certificateToPem(titular)
    };
    return this.cache;
  }
}
