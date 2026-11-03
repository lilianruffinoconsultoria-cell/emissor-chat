export type IdModulo = 'nfe' | 'nfse';

export type ModuloInfo = {
  id: IdModulo;
  nome: string;
  assunto: string;
  destino: string;
  ultima: { autor: 'eu' | 'bot'; texto: string; criadoEm: string } | null;
};

export type Nota = {
  modelo?: IdModulo; // mensagens antigas da NF-e nao tinham o campo
  id: number;
  numero: number;
  serie: number;
  status: 'autorizada' | 'rejeitada' | 'pendente' | 'erro' | 'cancelada';
  total: number;
  numeroNota?: string | null;
  chave?: string | null;
  protocolo?: string | null;
  cStat?: string | null;
  xMotivo?: string | null;
};

export type Mensagem = {
  id: string | number;
  autor: 'eu' | 'bot';
  texto: string;
  sugestoes?: string[];
  nota?: Nota;
  criadoEm: string;
  envio?: 'enviando' | 'falhou';
};

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** "HOJE", "ONTEM" ou a data, como o separador de dias do chat. */
export function dia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86400000);
  const mesmo = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mesmo(d, hoje)) return 'HOJE';
  if (mesmo(d, ontem)) return 'ONTEM';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: d.getFullYear() === hoje.getFullYear() ? undefined : 'numeric' }).toUpperCase();
}

/** Ultima mensagem na lista de conversas: sem marcacao e so a primeira linha. */
export const previa = (t: string) => t.replace(/[*_]/g, '').split('\n').find((l) => l.trim()) ?? '';

export const iniciais: Record<IdModulo, string> = { nfe: 'NF', nfse: 'NS' };
