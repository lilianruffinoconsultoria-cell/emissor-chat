import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Cadastros, type Aba } from './Cadastros.tsx';
import { Baixar, Clipe, Enviar, IconeMenu, Tique, Voltar } from './icones.tsx';
import { brl, dia, hora, iniciais, type IdModulo, type Mensagem, type ModuloInfo, type Nota } from './tipos.ts';

/** Formatacao de chat: *negrito* e _italico_. */
function formatar(texto: string): ReactNode[] {
  return texto.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((parte, i) => {
    if (/^\*[^*]+\*$/.test(parte)) return <strong key={i}>{parte.slice(1, -1)}</strong>;
    if (/^_[^_]+_$/.test(parte)) return <em key={i}>{parte.slice(1, -1)}</em>;
    return parte;
  });
}

const ROTULO: Record<Nota['status'], string> = {
  autorizada: 'Autorizada',
  rejeitada: 'Rejeitada',
  pendente: 'Aguardando resposta',
  erro: 'Não enviada',
  cancelada: 'Cancelada'
};

const chaveEmBlocos = (c: string) => c.replace(/(\d{4})(?=\d)/g, '$1 ');

/** A nota aparece como um documento anexado, com o PDF e o XML para baixar. */
function BolhaNota({ nota }: { nota: Nota }) {
  const modelo: IdModulo = nota.modelo ?? 'nfe';
  const base = `/api/${modelo}/notas/${nota.id}`;
  const temPdf = Boolean(nota.chave) && (nota.status === 'autorizada' || (modelo === 'nfse' && nota.status === 'cancelada'));
  const temXml = modelo === 'nfse' ? nota.status !== 'erro' : Boolean(nota.chave);
  const nome = modelo === 'nfse'
    ? nota.numeroNota ? `NFS-e ${nota.numeroNota}` : `DPS ${nota.numero}`
    : `NF-e ${nota.numero} · série ${nota.serie}`;
  const pdf = modelo === 'nfse' ? 'DANFSe' : 'DANFE';
  return (
    <div className={`doc doc-${nota.status}`}>
      <div className="doc-previa">
        <span className="doc-selo">{ROTULO[nota.status]}</span>
        <span className="doc-total">{brl(nota.total)}</span>
        {nota.cStat && nota.status !== 'autorizada' && <span className="doc-codigo">código {nota.cStat}</span>}
      </div>
      <a className="doc-faixa" href={temPdf ? `${base}/${modelo === 'nfse' ? 'danfse' : 'danfe'}` : temXml ? `${base}/xml` : undefined}
        target={temPdf ? '_blank' : undefined} rel="noreferrer" aria-disabled={!temPdf && !temXml}>
        <span className={`doc-icone ${temPdf ? 'pdf' : 'xml'}`}>{temPdf ? 'PDF' : 'XML'}</span>
        <span className="doc-texto">
          <b>{nome}</b>
          <small>{temPdf ? `${pdf} • PDF` : temXml ? 'XML enviado' : 'sem arquivo'}{nota.protocolo ? ` • protocolo ${nota.protocolo}` : ''}</small>
        </span>
        {(temPdf || temXml) && <span className="doc-baixar"><Baixar /></span>}
      </a>
      {nota.chave && <div className="doc-chave">{chaveEmBlocos(nota.chave)}</div>}
      {temPdf && temXml && <a className="doc-xml" href={`${base}/xml`}>Baixar XML</a>}
    </div>
  );
}

type ItemMenu = { id: string; rotulo: string; cor: string; aba?: Aba; enviar?: string };

const MENU: Record<IdModulo, ItemMenu[]> = {
  nfe: [
    { id: 'produtos', rotulo: 'Produtos', cor: 'document', aba: 'produtos' },
    { id: 'clientes', rotulo: 'Destinatários', cor: 'contact', aba: 'clientes' },
    { id: 'notas', rotulo: 'Notas', cor: 'gallery', enviar: 'notas' },
    { id: 'diagnostico', rotulo: 'Diagnóstico', cor: 'location', enviar: 'diagnostico' },
    { id: 'ajuda', rotulo: 'Ajuda', cor: 'poll', enviar: 'ajuda' }
  ],
  nfse: [
    { id: 'servicos', rotulo: 'Serviços', cor: 'camera', aba: 'servicos' },
    { id: 'clientes', rotulo: 'Tomadores', cor: 'contact', aba: 'clientes' },
    { id: 'notas', rotulo: 'Notas', cor: 'gallery', enviar: 'notas' },
    { id: 'diagnostico', rotulo: 'Diagnóstico', cor: 'location', enviar: 'diagnostico' },
    { id: 'ajuda', rotulo: 'Ajuda', cor: 'poll', enviar: 'ajuda' }
  ]
};

export function Conversa({ modulo, voltar, atualizado }: { modulo: ModuloInfo; voltar: () => void; atualizado: () => void }) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [falhaApi, setFalhaApi] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [painel, setPainel] = useState<Aba | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMensagens([]);
    fetch(`/api/${modulo.id}/mensagens`)
      .then((r) => r.json())
      .then((m: Mensagem[]) => {
        setMensagens(m);
        setFalhaApi(false);
      })
      .catch(() => setFalhaApi(true));
  }, [modulo.id]);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens, enviando]);

  async function enviar(conteudo: string, origem?: 'menu', reenviar?: Mensagem['id']) {
    const limpo = conteudo.trim();
    if (!limpo || enviando) return;
    setMenuAberto(false);
    if (/^(abrir menu|menu|cadastros?)$/i.test(limpo)) {
      setTexto('');
      setMenuAberto(true);
      return;
    }
    setTexto('');
    setEnviando(true);
    const id = reenviar ?? `eu-${Date.now()}`;
    const minha: Mensagem = { id, autor: 'eu', texto: limpo, criadoEm: new Date().toISOString(), envio: 'enviando' };
    setMensagens((m) => (reenviar ? m.map((x) => (x.id === id ? minha : x)) : [...m, minha]));
    try {
      const res = await fetch(`/api/${modulo.id}/mensagens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: limpo, origem })
      });
      if (!res.ok) throw new Error(String(res.status));
      const respostas = (await res.json()) as Omit<Mensagem, 'id' | 'autor' | 'criadoEm'>[];
      const agora = new Date().toISOString();
      setMensagens((m) => [
        ...m.map((x) => (x.id === id ? { ...x, envio: undefined } : x)),
        ...respostas.map((r, i) => ({ ...r, id: `bot-${Date.now()}-${i}`, autor: 'bot' as const, criadoEm: agora }))
      ]);
      setFalhaApi(false);
      atualizado();
    } catch {
      setMensagens((m) => m.map((x) => (x.id === id ? { ...x, envio: 'falhou' } : x)));
      setFalhaApi(true);
    } finally {
      setEnviando(false);
      campo.current?.focus();
    }
  }

  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    void enviar(texto);
  }

  const fecharPainel = useCallback(() => setPainel(null), []);

  useEffect(() => {
    if (!menuAberto) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && setMenuAberto(false);
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [menuAberto]);

  const ultima = mensagens.at(-1);
  const sugestoes = !enviando && ultima?.autor === 'bot' ? ultima.sugestoes : undefined;

  return (
    <section className="conversa" aria-label={`Conversa ${modulo.nome}`}>
      <header className="conversa-topo">
        <button type="button" className="botao-icone so-celular" aria-label="Voltar para as conversas" onClick={voltar}>
          <Voltar />
        </button>
        <div className={`avatar avatar-${modulo.id}`} aria-hidden="true">{iniciais[modulo.id]}</div>
        <div className="topo-texto">
          <h2>{modulo.nome} · {modulo.assunto}</h2>
          <p>{enviando ? 'digitando...' : `${modulo.destino} · homologação`}</p>
        </div>
        <span className="selo-ambiente">SEM VALOR FISCAL</span>
      </header>

      <div className="mensagens" aria-live="polite">
        {falhaApi && <div className="aviso">Sem conexão com o servidor do emissor. Ele está rodando?</div>}
        {mensagens.map((m, i) => {
          const novoDia = i === 0 || dia(mensagens[i - 1].criadoEm) !== dia(m.criadoEm);
          const sequencia = i > 0 && mensagens[i - 1].autor === m.autor && !novoDia;
          return (
            <Fragment key={m.id}>
              {novoDia && <div className="separador-dia">{dia(m.criadoEm)}</div>}
              <div className={`linha ${m.autor}${sequencia ? ' seguida' : ''}`}>
                <div className="balao">
                  {m.nota && <BolhaNota nota={m.nota} />}
                  <span className="balao-texto">{formatar(m.texto)}</span>
                  <span className="meta">
                    {hora(m.criadoEm)}
                    {m.autor === 'eu' && <Tique status={m.envio ?? 'lido'} />}
                  </span>
                  {m.envio === 'falhou' && (
                    <button type="button" className="reenviar" onClick={() => void enviar(m.texto, undefined, m.id)}>
                      Não enviada. Tocar para reenviar
                    </button>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
        {enviando && (
          <div className="linha bot">
            <div className="balao digitando" aria-label="Respondendo"><span /><span /><span /></div>
          </div>
        )}
        <div ref={fim} />
      </div>

      {sugestoes && sugestoes.length > 0 && (
        <div className="sugestoes">
          {sugestoes.map((s) => (
            <button key={s} type="button" onClick={() => void enviar(s)}>{s}</button>
          ))}
        </div>
      )}

      {menuAberto && (
        <>
          <div className="menu-fundo" onClick={() => setMenuAberto(false)} />
          <div className="menu-anexos" role="menu" aria-label="Menu">
            {MENU[modulo.id].map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="anexo"
                onClick={() => {
                  setMenuAberto(false);
                  if (item.aba) setPainel(item.aba);
                  else if (item.enviar) void enviar(item.enviar);
                }}
              >
                <i style={{ background: `linear-gradient(180deg, var(--att-${item.cor}))` }}><IconeMenu nome={item.id} /></i>
                {item.rotulo}
              </button>
            ))}
          </div>
        </>
      )}

      <form className="composer" onSubmit={aoEnviar}>
        <div className="pilula">
          <textarea
            ref={campo}
            rows={1}
            value={texto}
            placeholder="Mensagem"
            aria-label="Mensagem"
            autoFocus
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) aoEnviar(e);
            }}
          />
          <button type="button" className="botao-icone" aria-label="Abrir menu de cadastros" aria-expanded={menuAberto} onClick={() => setMenuAberto((v) => !v)}>
            <Clipe />
          </button>
        </div>
        <button type="submit" className="acao" aria-label="Enviar" disabled={!texto.trim() || enviando}>
          <Enviar />
        </button>
      </form>

      {painel && (
        <Cadastros
          modulo={modulo.id}
          abaInicial={painel}
          fechar={fecharPainel}
          usar={(t) => {
            setPainel(null);
            void enviar(t, 'menu');
          }}
        />
      )}
    </section>
  );
}
