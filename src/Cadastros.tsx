import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Fechar } from './icones.tsx';
import { brl, type IdModulo } from './tipos.ts';

export type Aba = 'produtos' | 'servicos' | 'clientes';

type Produto = { descricao: string; ncm: string; unidade?: string; valorUnitario?: number };
type Servico = { descricao: string; codigo: string; valor?: number; nacional?: string };
type ItemLista = { codigo: string; rotulo: string; descricao: string; bloqueado: boolean };

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

type Cliente = { tipo: 'CPF' | 'CNPJ'; doc: string; nome?: string; ie?: string | null; email?: string; endereco?: Endereco };

const ABAS: Record<IdModulo, { id: Aba; rotulo: string }[]> = {
  nfe: [{ id: 'produtos', rotulo: 'Produtos' }, { id: 'clientes', rotulo: 'Destinatários' }],
  nfse: [{ id: 'servicos', rotulo: 'Serviços' }, { id: 'clientes', rotulo: 'Tomadores' }]
};

const UNIDADES = ['UN', 'CX', 'KG', 'G', 'L', 'M', 'PC', 'PAR', 'PCT', 'SC', 'FD', 'DZ'];
const valorBr = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const digitos = (s: string) => s.replace(/\D/g, '');
const codigoFormatado = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4, 6)}`;

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
  modo?: 'numeric' | 'decimal' | 'text' | 'email';
  aoSair?: () => void;
  somenteLeitura?: boolean;
  multilinha?: boolean;
}) {
  return (
    <label className="campo">
      <span>{props.rotulo}</span>
      {props.multilinha ? (
        <textarea rows={3} value={props.valor} onChange={(e) => props.aoMudar(e.target.value)} />
      ) : (
        <input
          value={props.valor}
          inputMode={props.modo ?? 'text'}
          readOnly={props.somenteLeitura}
          onChange={(e) => props.aoMudar(e.target.value)}
          onBlur={props.aoSair}
        />
      )}
      {props.dica && <small>{props.dica}</small>}
    </label>
  );
}

function confirmarExclusao(nome: string) {
  return window.confirm(`Excluir ${nome}?`);
}

const produtoVazio = { descricao: '', ncm: '', unidade: 'UN', valor: '' };

function AbaProdutos({ usar }: { usar: (texto: string) => void }) {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [form, setForm] = useState<typeof produtoVazio | null>(null);
  const [erro, setErro] = useState('');
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});

  const recarregar = useCallback(() => {
    fetch('/api/nfe/produtos').then((r) => r.json()).then(setProdutos).catch(() => undefined);
  }, []);
  useEffect(recarregar, [recarregar]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      await enviarJson('/api/nfe/produtos', { descricao: form.descricao, ncm: form.ncm, unidade: form.unidade, valorUnitario: form.valor });
      setForm(null);
      setErro('');
      recarregar();
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  async function excluir(p: Produto) {
    if (!confirmarExclusao(p.descricao)) return;
    await fetch(`/api/nfe/produtos/${encodeURIComponent(p.descricao)}`, { method: 'DELETE' });
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

const servicoVazio = { descricao: '', codigo: '', busca: '', valor: '' };

function AbaServicos({ usar }: { usar: (texto: string) => void }) {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [form, setForm] = useState<typeof servicoVazio | null>(null);
  const [achados, setAchados] = useState<ItemLista[]>([]);
  const [erro, setErro] = useState('');

  const recarregar = useCallback(() => {
    fetch('/api/nfse/servicos').then((r) => r.json()).then(setServicos).catch(() => undefined);
  }, []);
  useEffect(recarregar, [recarregar]);

  // Busca na lista nacional enquanto digita a descricao ou o codigo.
  const consulta = form ? form.busca || form.descricao : '';
  useEffect(() => {
    if (!form || consulta.trim().length < 3) {
      setAchados([]);
      return;
    }
    const pedido = new AbortController();
    const espera = setTimeout(() => {
      fetch(`/api/nfse/lista-nacional?q=${encodeURIComponent(consulta)}`, { signal: pedido.signal })
        .then((r) => r.json())
        .then(setAchados)
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(espera);
      pedido.abort();
    };
  }, [consulta, Boolean(form)]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    try {
      await enviarJson('/api/nfse/servicos', { descricao: form.descricao, codigo: form.codigo, valor: form.valor });
      setForm(null);
      setErro('');
      recarregar();
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  async function excluir(s: Servico) {
    if (!confirmarExclusao(s.descricao)) return;
    await fetch(`/api/nfse/servicos/${encodeURIComponent(s.descricao)}`, { method: 'DELETE' });
    recarregar();
  }

  if (form) {
    return (
      <form className="formulario" onSubmit={salvar}>
        <Campo rotulo="Descrição na nota" valor={form.descricao} multilinha aoMudar={(v) => setForm({ ...form, descricao: v })}
          dica="Como o serviço vai aparecer para o tomador" />
        <Campo rotulo="Código da lista nacional" valor={form.busca || (form.codigo ? codigoFormatado(form.codigo) : '')}
          dica="Digite o código (17.01) ou palavras do serviço e escolha abaixo"
          aoMudar={(v) => setForm({ ...form, busca: v, codigo: '' })} />
        {achados.length > 0 && !form.codigo && (
          <ul className="opcoes" role="listbox" aria-label="Códigos encontrados">
            {achados.map((a) => (
              <li key={a.codigo}>
                <button type="button" disabled={a.bloqueado} onClick={() => setForm({ ...form, codigo: a.codigo, busca: '' })}>
                  <b>{a.rotulo}</b> {a.descricao}{a.bloqueado ? ' (exige dados de obra ou evento)' : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Campo rotulo="Valor habitual (R$)" valor={form.valor} modo="decimal" dica="Opcional" aoMudar={(v) => setForm({ ...form, valor: v })} />
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="acoes-form">
          <button type="button" className="secundario" onClick={() => { setForm(null); setErro(''); }}>Voltar</button>
          <button type="submit" className="primario" disabled={!form.codigo}>Salvar serviço</button>
        </div>
      </form>
    );
  }

  return (
    <>
      <button type="button" className="novo" onClick={() => setForm(servicoVazio)}>+ Novo serviço</button>
      {!servicos.length && <p className="vazio">Nenhum serviço ainda. Os que você usar no chat aparecem aqui.</p>}
      <ul className="lista">
        {servicos.map((s) => (
          <li key={s.descricao}>
            <div className="item-info">
              <strong>{s.descricao}</strong>
              <span>{codigoFormatado(s.codigo)}{s.nacional ? ` · ${s.nacional}` : ''}{s.valor ? ` · ${brl(s.valor)}` : ''}</span>
            </div>
            <div className="item-acoes">
              <button type="button" className="primario" onClick={() => usar(s.descricao)}>Usar na nota</button>
              <button type="button" className="link" onClick={() => setForm({ descricao: s.descricao, codigo: s.codigo, busca: '', valor: s.valor ? valorBr(s.valor) : '' })}>Editar</button>
              <button type="button" className="link perigo" onClick={() => void excluir(s)}>Excluir</button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

const clienteVazio = {
  doc: '', nome: '', ie: '', email: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '', codigoMunicipio: ''
};

function paraForm(c: Cliente): typeof clienteVazio {
  const e = c.endereco ?? {};
  return {
    doc: formatarDoc(c.doc),
    nome: c.nome ?? '',
    ie: c.ie ?? '',
    email: c.email ?? '',
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

function AbaClientes({ modulo, usar }: { modulo: IdModulo; usar: (texto: string) => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [form, setForm] = useState<typeof clienteVazio | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const quem = modulo === 'nfse' ? 'tomador' : 'destinatário';

  const recarregar = useCallback(() => {
    fetch('/api/clientes').then((r) => r.json()).then(setClientes).catch(() => undefined);
  }, []);
  useEffect(recarregar, [recarregar]);

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
    const { doc, nome, ie, email, ...endereco } = form;
    try {
      await enviarJson('/api/clientes', { doc, nome, ie, email, endereco });
      setForm(null);
      setErro('');
      setAviso('');
      recarregar();
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  async function excluir(c: Cliente) {
    if (!confirmarExclusao(c.nome ?? c.doc)) return;
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
        {modulo === 'nfe'
          ? <Campo rotulo="Inscrição Estadual" valor={form.ie} modo="numeric" dica="Deixe vazio se não for contribuinte do ICMS" aoMudar={mudar('ie')} />
          : <Campo rotulo="E-mail" valor={form.email} modo="email" dica="Opcional: vai na NFS-e" aoMudar={mudar('email')} />}
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
          <button type="submit" className="primario">Salvar {quem}</button>
        </div>
      </form>
    );
  }

  return (
    <>
      <button type="button" className="novo" onClick={() => setForm(clienteVazio)}>+ Novo {quem}</button>
      {!clientes.length && <p className="vazio">Nenhum cliente ainda. Eles valem para a NF-e e para a NFS-e.</p>}
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

export function Cadastros({ modulo, abaInicial, fechar, usar }: { modulo: IdModulo; abaInicial: Aba; fechar: () => void; usar: (texto: string) => void }) {
  const [aba, setAba] = useState<Aba>(abaInicial);

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
        <div className="alca" aria-hidden="true" />
        <header className="painel-topo">
          <h2>Cadastros</h2>
          <button type="button" className="botao-icone" aria-label="Fechar" onClick={fechar}><Fechar /></button>
        </header>
        <div className="abas" role="tablist">
          {ABAS[modulo].map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}>{a.rotulo}</button>
          ))}
        </div>
        <div className="painel-corpo">
          {aba === 'produtos' && <AbaProdutos usar={usar} />}
          {aba === 'servicos' && <AbaServicos usar={usar} />}
          {aba === 'clientes' && <AbaClientes modulo={modulo} usar={usar} />}
        </div>
        <footer className="painel-rodape">
          <button type="button" className="secundario" onClick={fechar}>Seguir pelo chat</button>
        </footer>
      </aside>
    </div>
  );
}
