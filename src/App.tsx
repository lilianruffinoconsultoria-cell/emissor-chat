import { useCallback, useEffect, useState } from 'react';
import { Conversa } from './Conversa.tsx';
import { Lua } from './icones.tsx';
import { dia, hora, iniciais, previa, type IdModulo, type ModuloInfo } from './tipos.ts';

const lerHash = (): IdModulo | null => {
  const h = location.hash.replace('#', '');
  return h === 'nfe' || h === 'nfse' ? h : null;
};

function guardar(chave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {
    // Sem armazenamento (janela privada): o tema volta ao do sistema.
  }
}

function lerTema(): string | null {
  try {
    return localStorage.getItem('tema');
  } catch {
    return null;
  }
}

/** Alterna claro/escuro; sem escolha salva, segue o sistema. */
function alternarTema() {
  const r = document.documentElement;
  const escuro = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.theme = escuro ? 'light' : 'dark';
  guardar('tema', r.dataset.theme);
}

export function App() {
  const [modulos, setModulos] = useState<ModuloInfo[]>([]);
  const [aberto, setAberto] = useState<IdModulo | null>(lerHash);
  const [falha, setFalha] = useState(false);

  const carregar = useCallback(() => {
    fetch('/api/modulos')
      .then((r) => r.json())
      .then((m: ModuloInfo[]) => {
        setModulos(m);
        setFalha(false);
      })
      .catch(() => setFalha(true));
  }, []);

  useEffect(() => {
    const tema = lerTema();
    if (tema === 'dark' || tema === 'light') document.documentElement.dataset.theme = tema;
    carregar();
    const aoMudarHash = () => setAberto(lerHash());
    window.addEventListener('hashchange', aoMudarHash);
    return () => window.removeEventListener('hashchange', aoMudarHash);
  }, [carregar]);

  const abrir = (id: IdModulo | null) => {
    location.hash = id ?? '';
    setAberto(id);
  };

  // Na tela larga a primeira conversa ja abre; no celular a lista vem primeiro.
  const atual = modulos.find((m) => m.id === aberto) ?? (matchMedia('(min-width: 761px)').matches ? modulos[0] : undefined);

  return (
    <div className={`app${aberto ? ' com-conversa' : ''}`}>
      <aside className="lista-conversas" aria-label="Documentos">
        <header className="lista-topo">
          <div>
            <h1>Emissor Chat</h1>
            <p>Notas fiscais por conversa</p>
          </div>
          <button type="button" className="botao-icone" aria-label="Alternar tema claro e escuro" onClick={alternarTema}>
            <Lua />
          </button>
        </header>
        {falha && <p className="aviso">Sem conexão com o servidor do emissor.</p>}
        <ul>
          {modulos.map((m) => (
            <li key={m.id}>
              <button type="button" className={`contato${atual?.id === m.id ? ' ativo' : ''}`} aria-current={atual?.id === m.id} onClick={() => abrir(m.id)}>
                <span className={`avatar avatar-${m.id}`} aria-hidden="true">{iniciais[m.id]}</span>
                <span className="contato-texto">
                  <span className="contato-linha">
                    <b>{m.nome} · {m.assunto}</b>
                    {m.ultima && <small>{dia(m.ultima.criadoEm) === 'HOJE' ? hora(m.ultima.criadoEm) : dia(m.ultima.criadoEm).toLowerCase()}</small>}
                  </span>
                  <span className="contato-previa">{m.ultima ? `${m.ultima.autor === 'eu' ? 'Você: ' : ''}${previa(m.ultima.texto)}` : `Emitir pelo ${m.destino}`}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="rodape-lista">Homologação: notas de teste, sem valor fiscal.</p>
      </aside>

      {atual ? (
        <Conversa key={atual.id} modulo={atual} voltar={() => abrir(null)} atualizado={carregar} />
      ) : (
        <section className="conversa vazia" aria-hidden="true" />
      )}
    </div>
  );
}
