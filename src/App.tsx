import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Cadastros } from './Cadastros.tsx';

type Nota = {
  id: number;
  numero: number;
  serie: number;
  status: 'autorizada' | 'rejeitada' | 'pendente' | 'erro';
  total: number;
  chave?: string | null;
  protocolo?: string | null;
  cStat?: string | null;
  xMotivo?: string | null;
};

type Mensagem = {
  id: string | number;
  autor: 'eu' | 'bot';
  texto: string;
  sugestoes?: string[];
  nota?: Nota;
  criadoEm: string;
};

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const chaveEmBlocos = (c: string) => c.replace(/(\d{4})(?=\d)/g, '$1 ');

/** Formatacao do WhatsApp: *negrito* e _italico_. */
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
  pendente: 'Aguardando SEFAZ',
  erro: 'Não enviada'
};

function CartaoNota({ nota }: { nota: Nota }) {
  return (
    <div className={`nota nota-${nota.status}`}>
      <div className="nota-topo">
        <span>NF-e {nota.numero} · série {nota.serie}</span>
        <span className="nota-selo">{ROTULO[nota.status]}</span>
      </div>
      <div className="nota-total">{brl(nota.total)}</div>
      {nota.chave && <div className="nota-chave">{chaveEmBlocos(nota.chave)}</div>}
      {nota.protocolo && <div className="nota-info">Protocolo {nota.protocolo}</div>}
      {nota.chave && (
        <div className="nota-acoes">
          {nota.status === 'autorizada' && (
            <a href={`/api/notas/${nota.id}/danfe`} target="_blank" rel="noreferrer">DANFE (PDF)</a>
          )}
          <a href={`/api/notas/${nota.id}/xml`}>Baixar XML</a>
        </div>
      )}
    </div>
  );
}

export function App() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [falhaApi, setFalhaApi] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/mensagens')
      .then((r) => r.json())
      .then(setMensagens)
      .catch(() => setFalhaApi(true));
  }, []);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens, enviando]);

  async function enviar(conteudo: string, origem?: 'menu') {
    const limpo = conteudo.trim();
    if (!limpo || enviando) return;
    if (/^(abrir menu|menu|cadastros?)$/i.test(limpo)) {
      setTexto('');
      setMenuAberto(true);
      return;
    }
    setTexto('');
    setEnviando(true);
    setMensagens((m) => [...m, { id: `eu-${Date.now()}`, autor: 'eu', texto: limpo, criadoEm: new Date().toISOString() }]);
    try {
      const res = await fetch('/api/mensagens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: limpo, origem })
      });
      const respostas = (await res.json()) as Omit<Mensagem, 'id' | 'autor' | 'criadoEm'>[];
      const agora = new Date().toISOString();
      setMensagens((m) => [
        ...m,
        ...respostas.map((r, i) => ({ ...r, id: `bot-${Date.now()}-${i}`, autor: 'bot' as const, criadoEm: agora }))
      ]);
      setFalhaApi(false);
    } catch {
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

  const fecharMenu = useCallback(() => setMenuAberto(false), []);

  const ultima = mensagens.at(-1);
  const sugestoes = !enviando && ultima?.autor === 'bot' ? ultima.sugestoes : undefined;

  return (
    <div className="app">
      <header className="topo">
        <div className="avatar" aria-hidden="true">NF</div>
        <div className="topo-texto">
          <h1>Emissor NF-e</h1>
          <p>{enviando ? 'digitando...' : 'SEFAZ-SP · homologação'}</p>
        </div>
        <span className="selo-ambiente">SEM VALOR FISCAL</span>
      </header>

      <main className="conversa" aria-live="polite">
        {falhaApi && <div className="aviso">Sem conexão com o servidor do emissor. Ele está rodando?</div>}
        {mensagens.map((m) => (
          <div key={m.id} className={`linha ${m.autor}`}>
            <div className="balao">
              <div className="balao-texto">{formatar(m.texto)}</div>
              {m.nota && <CartaoNota nota={m.nota} />}
              <div className="balao-hora">
                {hora(m.criadoEm)}
                {m.autor === 'eu' && <span className="tique" aria-hidden="true">✓✓</span>}
              </div>
            </div>
          </div>
        ))}
        {enviando && (
          <div className="linha bot">
            <div className="balao digitando" aria-label="Respondendo">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={fim} />
      </main>

      {sugestoes && sugestoes.length > 0 && (
        <div className="sugestoes">
          {sugestoes.map((s) => (
            <button key={s} type="button" onClick={() => void enviar(s)}>{s}</button>
          ))}
        </div>
      )}

      <form className="entrada" onSubmit={aoEnviar}>
        <button type="button" className="abrir-menu" aria-label="Abrir cadastros" onClick={() => setMenuAberto(true)}>+</button>
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
        <button type="submit" aria-label="Enviar" disabled={!texto.trim() || enviando}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.6 2-12.6 2z" />
          </svg>
        </button>
      </form>

      {menuAberto && (
        <Cadastros
          fechar={fecharMenu}
          usar={(t) => {
            setMenuAberto(false);
            void enviar(t, 'menu');
          }}
        />
      )}
    </div>
  );
}
