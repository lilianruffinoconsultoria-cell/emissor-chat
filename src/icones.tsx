// Icones desenhados para o emissor, no traco da previa do modelo de design. Nenhum asset de terceiros.
type P = { tamanho?: number };

const traco = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Enviar = ({ tamanho = 22 }: P) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 20l18-8L3 4l2 8zM5 12h8" {...traco} strokeWidth={2} />
  </svg>
);

export const Clipe = ({ tamanho = 22 }: P) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M16.5 7.5l-7 7a2 2 0 0 0 2.8 2.8l7.4-7.4a4 4 0 0 0-5.7-5.7L6.6 11.6a6 6 0 0 0 8.5 8.5L21 14" {...traco} />
  </svg>
);

export const Voltar = ({ tamanho = 24 }: P) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" {...traco} strokeWidth={2} />
  </svg>
);

export const Fechar = ({ tamanho = 22 }: P) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" {...traco} strokeWidth={2} />
  </svg>
);

export const Lua = ({ tamanho = 20 }: P) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" {...traco} />
  </svg>
);

export const Baixar = ({ tamanho = 20 }: P) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" {...traco} strokeWidth={2} />
  </svg>
);

/** Status da mensagem enviada: relogio (pendente), dois tiques azuis (respondida) ou falha. */
export function Tique({ status }: { status: 'enviando' | 'lido' | 'falhou' }) {
  if (status === 'enviando') {
    return (
      <svg className="tique" viewBox="0 0 16 16" width="15" height="15" aria-label="Enviando">
        <circle cx="8" cy="8" r="6" {...traco} strokeWidth={1.5} />
        <path d="M8 4.5V8l2.2 1.4" {...traco} strokeWidth={1.5} />
      </svg>
    );
  }
  if (status === 'falhou') {
    return (
      <svg className="tique falhou" viewBox="0 0 16 16" width="15" height="15" aria-label="Falhou">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="M8 4v5M8 11.5v.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="tique lido" viewBox="0 0 16 11" width="16" height="11" aria-label="Respondida">
      <path d="M1 6l3 3 7-7M6 8.5l1 .5 7-7" {...traco} strokeWidth={1.6} />
    </svg>
  );
}

// Menu de anexos: um desenho por acao.
export const ICONES_MENU: Record<string, string> = {
  produtos: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
  servicos: 'M14.5 6.5l3 3M4 20l6.5-6.5M13 4l7 7-3 3-7-7zM9.5 11.5l3 3',
  clientes: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  notas: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  diagnostico: 'M3 12h4l2-6 4 12 2-6h6',
  ajuda: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5'
};

export const IconeMenu = ({ nome }: { nome: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d={ICONES_MENU[nome]} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
