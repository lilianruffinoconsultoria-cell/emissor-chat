// Consultas publicas gratuitas usadas para preencher cadastro a partir do chat.
import type { EnderecoProps } from '@brasil-fiscal/nfe';

export type EmpresaPublica = {
  razaoSocial: string;
  nomeFantasia?: string;
  situacao: string;
  simples: boolean;
  mei: boolean;
  endereco: Partial<EnderecoProps>;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'emissor-chat/0.2 (emissor NF-e e NFS-e local)', Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const so = (v: unknown) => String(v ?? '').trim();

export async function consultarCnpj(cnpj: string): Promise<EmpresaPublica | null> {
  const r = await getJson<Record<string, unknown>>(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!r) return consultarCnpjAlternativo(cnpj);
  const logradouro = [so(r.descricao_tipo_de_logradouro), so(r.logradouro)].filter(Boolean).join(' ');
  return {
    razaoSocial: so(r.razao_social),
    nomeFantasia: so(r.nome_fantasia) || undefined,
    situacao: so(r.descricao_situacao_cadastral),
    simples: r.opcao_pelo_simples === true,
    mei: r.opcao_pelo_mei === true,
    endereco: {
      logradouro,
      numero: so(r.numero) || 'S/N',
      complemento: so(r.complemento) || undefined,
      bairro: so(r.bairro),
      codigoMunicipio: so(r.codigo_municipio_ibge),
      municipio: so(r.municipio),
      uf: so(r.uf),
      cep: so(r.cep).replace(/\D/g, '')
    }
  };
}

type CnpjWs = {
  razao_social?: string;
  simples?: { simples?: string; mei?: string };
  estabelecimento?: Record<string, unknown> & {
    estado?: { sigla?: string };
    cidade?: { nome?: string; ibge_id?: number };
    situacao_cadastral?: string;
  };
};

async function consultarCnpjAlternativo(cnpj: string): Promise<EmpresaPublica | null> {
  const r = await getJson<CnpjWs>(`https://publica.cnpj.ws/cnpj/${cnpj}`);
  const e = r?.estabelecimento;
  if (!r || !e) return null;
  return {
    razaoSocial: so(r.razao_social),
    nomeFantasia: so(e.nome_fantasia) || undefined,
    situacao: so(e.situacao_cadastral),
    simples: /sim/i.test(so(r.simples?.simples)),
    mei: /sim/i.test(so(r.simples?.mei)),
    endereco: {
      logradouro: [so(e.tipo_logradouro), so(e.logradouro)].filter(Boolean).join(' '),
      numero: so(e.numero) || 'S/N',
      complemento: so(e.complemento) || undefined,
      bairro: so(e.bairro),
      codigoMunicipio: so(e.cidade?.ibge_id),
      municipio: so(e.cidade?.nome),
      uf: so(e.estado?.sigla),
      cep: so(e.cep).replace(/\D/g, '')
    }
  };
}

export async function consultarCep(cep: string): Promise<Partial<EnderecoProps> | null> {
  const r = await getJson<Record<string, string> & { erro?: unknown }>(`https://viacep.com.br/ws/${cep}/json/`);
  if (!r || r.erro) return null;
  return {
    logradouro: so(r.logradouro),
    bairro: so(r.bairro),
    codigoMunicipio: so(r.ibge),
    municipio: so(r.localidade),
    uf: so(r.uf),
    cep
  };
}
