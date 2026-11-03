import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Produto = { descricao: string; ncm: string; unidade?: string; valorUnitario?: number };

type Endereco = {
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  codigoMunicipio?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
};

type Cliente = { tipo: 'CPF' | 'CNPJ'; doc: string; nome?: string; ie?: string | null; endereco?: Endereco };

const UNIDADES = ['UN', 'CX', 'KG', 'G', 'L', 'M', 'PC', 'PAR', 'PCT', 'SC', 'FD', 'DZ'];
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const valorBr = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const digitos = (s: string) => s.replace(/\D/g, '');

const formatarDoc = (d: string) =>
  d.length === 14
    ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
    : d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

async function enviarJson(url: string, corpo: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo)
  });
  if (!res.ok) throw new Error(((await res.json()) as { erro?: string }).erro ?? 'Não foi possível salvar.');
}

function Campo(props: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  dica?: string;
  modo?: 'numeric' | 'decimal' | 'text';
  aoSair?: () => void;
  somenteLeitura?: boolean;
}) {
  return (
    <label className="campo">
      <span>{props.rotulo}</span>
      <input
        value={props.valor}
        inputMode={props.modo ?? 'text'}
        readOnly={props.somenteLeitura}
        onChange={(e) => props.aoMudar(e.target.value)}
        onBlur={props.aoSair}
      />
      {props.dica && <small>{props.dica}</small>}
    </label>
  );
}

const produtoVazio = { descricao: '', ncm: '', unidade: 'UN', valor: '' };

function AbaProdutos({ produtos, recarregar, usar }: { produtos: Produto[]; recarregar: () => void; usar: (texto: string) => void }) {
  const [form, setForm] = useState<typeof produtoVazio | null>(null);
  const [erro, setErro] = useState('');
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      await enviarJson('/api/produtos', { descricao: form.descricao, ncm: form.ncm, unidade: form.unidade, valorUnitario: form.valor });
      setForm(null);
      setErro('');
      recarregar();
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  async function excluir(p: Produto) {
    if (!window.confirm(`Excluir ${p.descricao}?`)) return;
    await fetch(`/api/produtos/${encodeURIComponent(p.descricao)}`, { method: 'DELETE' });
    recarregar();
  }

  if (form) {
    return (
      <form className="formulario" onSubmit={salvar}>
        <Campo rotulo="Descrição" valor={form.descricao} aoMudar={(v) => setForm({ ...form, descricao: v })} />
        <Campo rotulo="NCM" valor={form.ncm} modo="numeric" dica="8 dígitos, ex.: 7318.15.00" aoMudar={(v) => setForm({ ...form, ncm: v })} />
        <div className="duas-colunas">
          <label className="campo">
            <span>Unidade</span>
            <select value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })}>
              {UNIDADES.map((u) => <option key={u}>{u}</option>)}
            </select>
          </label>
          <Campo rotulo="Valor unitário (R$)" valor={form.valor} modo="decimal" aoMudar={(v) => setForm({ ...form, valor: v })} />
        </div>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-form">
          <button type="button" className="secundario" onClick={() => { setForm(null); setErro(''); }}>Voltar</button>
          <button type="submit" className="primario">Salvar produto</button>
        </div>
      </form>
    );
  }

  return (
    <>
      <button type="button" className="novo" onClick={() => setForm(produtoVazio)}>+ Novo produto</button>
      {!produtos.length && <p className="vazio">Nenhum produto ainda. Os que você usar no chat aparecem aqui.</p>}
      <ul className="lista">
        {produtos.map((p) => {
          const qtd = quantidades[p.descricao] ?? '1';
          return (
            <li key={p.descricao}>
              <div className="item-info">
                <strong>{p.descricao}</strong>
                <span>NCM {p.ncm} · {p.unidade ?? 'UN'}{p.valorUnitario ? ` · ${brl(p.valorUnitario)}` : ' · sem preço'}</span>
              </div>
              <div className="item-acoes">
                <input
                  className="qtd"
                  aria-label={`Quantidade de ${p.descricao}`}
                  inputMode="decimal"
                  value={qtd}
                  onChange={(e) => setQuantidades({ ...quantidades, [p.descricao]: e.target.value })}
                />
                <button
                  type="button"
                  className="primario"
                  disabled={!p.valorUnitario}
                  onClick={() => usar(`${qtd} ${p.unidade ?? 'UN'} ${p.descricao} a ${valorBr(p.valorUnitario!)}`)}
                >
                  Usar na nota
                </button>
                <button type="button" className="link" onClick={() => setForm({ descricao: p.descricao, ncm: p.ncm, unidade: p.unidade ?? 'UN', valor: p.valorUnitario ? valorBr(p.valorUnitario) : '' })}>Editar</button>
                <button type="button" className="link perigo" onClick={() => void excluir(p)}>Excluir</button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const clienteVazio = {
  doc: '', nome: '', ie: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '', codigoMunicipio: ''
};

function paraForm(c: Cliente): typeof clienteVazio {
  const e = c.endereco ?? {};
  return {
    doc: formatarDoc(c.doc),
    nome: c.nome ?? '',
    ie: c.ie ?? '',
    cep: e.cep ?? '',
    logradouro: e.logradouro ?? '',
    numero: e.numero ?? '',
    complemento: e.complemento ?? '',
    bairro: e.bairro ?? '',
    municipio: e.municipio ?? '',
    uf: e.uf ?? '',
    codigoMunicipio: e.codigoMunicipio ?? ''
  };
}

function AbaDestinatarios({ clientes, recarregar, usar }: { clientes: Cliente[]; recarregar: () => void; usar: (texto: string) => void }) {
  const [form, setForm] = useState<typeof clienteVazio | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  async function buscarCnpj() {
    if (!form) return;
    const doc = digitos(form.doc);
    if (doc.length !== 14) return;
    setAviso('Buscando CNPJ...');
    const res = await fetch(`/api/consulta/cnpj/${doc}`);
    if (!res.ok) {
      setAviso('CNPJ não encontrado: preencha os dados abaixo.');
      return;
    }
    const a = (await res.json()) as { nome?: string; ie?: string | null; endereco?: Endereco };
    const e = a.endereco ?? {};
    setForm((f) => f && {
      ...f,
      nome: a.nome ?? f.nome,
      ie: a.ie ?? f.ie,
      cep: e.cep ?? f.cep,
      logradouro: e.logradouro ?? f.logradouro,
      numero: e.numero ?? f.numero,
      complemento: e.complemento ?? f.complemento,
      bairro: e.bairro ?? f.bairro,
      municipio: e.municipio ?? f.municipio,
      uf: e.uf ?? f.uf,
      codigoMunicipio: e.codigoMunicipio ?? f.codigoMunicipio
    });
    setAviso('Dados encontrados. Confira antes de salvar.');
  }

  async function buscarCep() {
    if (!form || digitos(form.cep).length !== 8) return;
    const res = await fetch(`/api/consulta/cep/${digitos(form.cep)}`);
    if (!res.ok) {
      setAviso('CEP não encontrado.');
      return;
    }
    const e = (await res.json()) as Endereco;
    setForm((f) => f && {
      ...f,
      logradouro: e.logradouro || f.logradouro,
      bairro: e.bairro || f.bairro,
      municipio: e.municipio || f.municipio,
      uf: e.uf || f.uf,
      codigoMunicipio: e.codigoMunicipio || f.codigoMunicipio
    });
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const { doc, nome, ie, ...endereco } = form;
    try {
      await enviarJson('/api/clientes', { doc, nome, ie, endereco });
      setForm(null);
      setErro('');
      setAviso('');
      recarregar();
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  async function excluir(c: Cliente) {
    if (!window.confirm(`Excluir ${c.nome ?? c.doc}?`)) return;
    await fetch(`/api/clientes/${c.doc}`, { method: 'DELETE' });
    recarregar();
  }

  if (form) {
    const mudar = (campo: keyof typeof clienteVazio) => (v: string) => setForm({ ...form, [campo]: v });
    return (
      <form className="formulario" onSubmit={salvar}>
        <Campo rotulo="CPF ou CNPJ" valor={form.doc} modo="numeric" dica="Com CNPJ, os dados são buscados ao sair do campo" aoMudar={mudar('doc')} aoSair={() => void buscarCnpj()} />
        {aviso && <p className="aviso-form">{aviso}</p>}
        <Campo rotulo="Nome ou razão social" valor={form.nome} aoMudar={mudar('nome')} />
        <Campo rotulo="Inscrição Estadual" valor={form.ie} modo="numeric" dica="Deixe vazio se não for contribuinte do ICMS" aoMudar={mudar('ie')} />
        <Campo rotulo="CEP" valor={form.cep} modo="numeric" aoMudar={mudar('cep')} aoSair={() => void buscarCep()} />
        <Campo rotulo="Rua" valor={form.logradouro} aoMudar={mudar('logradouro')} />
        <div className="duas-colunas">
          <Campo rotulo="Número" valor={form.numero} aoMudar={mudar('numero')} />
          <Campo rotulo="Complemento" valor={form.complemento} aoMudar={mudar('complemento')} />
        </div>
        <Campo rotulo="Bairro" valor={form.bairro} aoMudar={mudar('bairro')} />
        <div className="duas-colunas">
          <Campo rotulo="Município" valor={form.municipio} somenteLeitura aoMudar={mudar('municipio')} />
          <Campo rotulo="UF" valor={form.uf} somenteLeitura aoMudar={mudar('uf')} />
        </div>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-form">
          <button type="button" className="secundario" onClick={() => { setForm(null); setErro(''); setAviso(''); }}>Voltar</button>
          <button type="submit" className="primario">Salvar destinatário</button>
        </div>
      </form>
    );
  }

  return (
    <>
      <button type="button" className="novo" onClick={() => setForm(clienteVazio)}>+ Novo destinatário</button>
      {!clientes.length && <p className="vazio">Nenhum destinatário ainda.</p>}
      <ul className="lista">
        {clientes.map((c) => (
          <li key={c.doc}>
            <div className="item-info">
              <strong>{c.nome ?? c.doc}</strong>
              <span>{c.tipo} {formatarDoc(c.doc)}{c.endereco?.municipio ? ` · ${c.endereco.municipio}/${c.endereco.uf}` : ''}</span>
            </div>
            <div className="item-acoes">
              <button type="button" className="primario" onClick={() => usar(`para ${formatarDoc(c.doc)}`)}>Usar na nota</button>
              <button type="button" className="link" onClick={() => setForm(paraForm(c))}>Editar</button>
              <button type="button" className="link perigo" onClick={() => void excluir(c)}>Excluir</button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Cadastros({ fechar, usar }: { fechar: () => void; usar: (texto: string) => void }) {
  const [aba, setAba] = useState<'produtos' | 'destinatarios'>('produtos');
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);

  const recarregar = useCallback(() => {
    fetch('/api/cadastros')
      .then((r) => r.json())
      .then((d: { produtos: Produto[]; clientes: Cliente[] }) => {
        setProdutos(d.produtos);
        setClientes(d.clientes);
      })
      .catch(() => undefined);
  }, []);

  useEffect(recarregar, [recarregar]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [fechar]);

  return (
    <div className="painel-fundo" onClick={fechar}>
      <aside className="painel" role="dialog" aria-modal="true" aria-label="Cadastros" onClick={(e) => e.stopPropagation()}>
        <header className="painel-topo">
          <h2>Cadastros</h2>
          <button type="button" className="fechar" aria-label="Fechar" onClick={fechar}>×</button>
        </header>
        <div className="abas" role="tablist">
          <button type="button" role="tab" aria-selected={aba === 'produtos'} onClick={() => setAba('produtos')}>Produtos</button>
          <button type="button" role="tab" aria-selected={aba === 'destinatarios'} onClick={() => setAba('destinatarios')}>Destinatários</button>
        </div>
        <div className="painel-corpo">
          {aba === 'produtos'
            ? <AbaProdutos produtos={produtos} recarregar={recarregar} usar={usar} />
            : <AbaDestinatarios clientes={clientes} recarregar={recarregar} usar={usar} />}
        </div>
        <footer className="painel-rodape">
          <button type="button" className="secundario" onClick={fechar}>Seguir pelo chat</button>
        </footer>
      </aside>
    </div>
  );
}
