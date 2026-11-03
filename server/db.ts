import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';

export type StatusNota = 'autorizada' | 'rejeitada' | 'pendente' | 'erro';

export type NotaRow = {
  id: number;
  numero: number;
  serie: number;
  status: StatusNota;
  chave: string | null;
  protocolo: string | null;
  cstat: string | null;
  xmotivo: string | null;
  destinatario: string;
  total: number;
  xml_enviado: string | null;
  xml_protocolado: string | null;
  regras_versao: string;
  criado_em: string;
};

export const db = new DatabaseSync(process.env.EMISSOR_DB ?? join(DATA_DIR, 'emissor.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS clientes (doc TEXT PRIMARY KEY, dados TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS produtos (chave TEXT PRIMARY KEY, dados TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS servicos (chave TEXT PRIMARY KEY, dados TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    autor TEXT NOT NULL,
    dados TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Tabela da NF-e (modelo 55). A NFS-e tem a propria tabela, criada pelo modulo dela.
  CREATE TABLE IF NOT EXISTS notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero INTEGER NOT NULL,
    serie INTEGER NOT NULL,
    status TEXT NOT NULL,
    chave TEXT,
    protocolo TEXT,
    cstat TEXT,
    xmotivo TEXT,
    destinatario TEXT NOT NULL,
    total REAL NOT NULL,
    payload TEXT NOT NULL,
    xml_enviado TEXT,
    xml_protocolado TEXT,
    regras_versao TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Numero rejeitado pode ser reaproveitado; autorizado ou pendente nunca.
  CREATE UNIQUE INDEX IF NOT EXISTS ux_nota_numero ON notas (serie, numero)
    WHERE status IN ('autorizada', 'pendente');
  CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nota_id INTEGER,
    evento TEXT NOT NULL,
    detalhe TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Bancos antigos so tinham a conversa da NF-e: as mensagens deles ficam nela.
for (const tabela of ['mensagens', 'auditoria']) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[];
  if (!colunas.some((c) => c.name === 'modulo')) db.exec(`ALTER TABLE ${tabela} ADD COLUMN modulo TEXT NOT NULL DEFAULT 'nfe'`);
}

export type TabelaJson = 'clientes' | 'produtos' | 'servicos';
type CampoJson = 'doc' | 'chave';

export function kvGet<T>(chave: string): T | null {
  const row = db.prepare('SELECT valor FROM kv WHERE chave = ?').get(chave) as { valor: string } | undefined;
  return row ? (JSON.parse(row.valor) as T) : null;
}

export function kvSet(chave: string, valor: unknown): void {
  db.prepare('INSERT INTO kv (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
    .run(chave, JSON.stringify(valor));
}

export function kvDel(chave: string): void {
  db.prepare('DELETE FROM kv WHERE chave = ?').run(chave);
}

export function buscarJson<T>(tabela: TabelaJson, campo: CampoJson, valor: string): T | null {
  const row = db.prepare(`SELECT dados FROM ${tabela} WHERE ${campo} = ?`).get(valor) as { dados: string } | undefined;
  return row ? (JSON.parse(row.dados) as T) : null;
}

export function salvarJson(tabela: TabelaJson, campo: CampoJson, valor: string, dados: unknown): void {
  db.prepare(
    `INSERT INTO ${tabela} (${campo}, dados) VALUES (?, ?) ON CONFLICT(${campo}) DO UPDATE SET dados = excluded.dados`
  ).run(valor, JSON.stringify(dados));
}

export function listarJson<T>(tabela: TabelaJson, campo: CampoJson): { id: string; dados: T }[] {
  const linhas = db.prepare(`SELECT ${campo} AS id, dados FROM ${tabela}`).all() as { id: string; dados: string }[];
  return linhas.map((l) => ({ id: l.id, dados: JSON.parse(l.dados) as T }));
}

export function excluirJson(tabela: TabelaJson, campo: CampoJson, valor: string): void {
  db.prepare(`DELETE FROM ${tabela} WHERE ${campo} = ?`).run(valor);
}

/** nota_id aponta para a tabela do modulo: notas (NF-e) ou nfse. */
export function registrarAuditoria(notaId: number | null, evento: string, detalhe?: string, modulo = 'nfe'): void {
  db.prepare('INSERT INTO auditoria (nota_id, evento, detalhe, modulo) VALUES (?, ?, ?, ?)').run(notaId, evento, detalhe ?? null, modulo);
}

export function salvarMensagem(modulo: string, autor: 'eu' | 'bot', dados: unknown): void {
  db.prepare('INSERT INTO mensagens (modulo, autor, dados) VALUES (?, ?, ?)').run(modulo, autor, JSON.stringify(dados));
}

export function listarMensagens(modulo: string): { id: number; autor: string; dados: string; criado_em: string }[] {
  return db.prepare('SELECT id, autor, dados, criado_em FROM mensagens WHERE modulo = ? ORDER BY id').all(modulo) as {
    id: number; autor: string; dados: string; criado_em: string;
  }[];
}

/** Reserva o proximo numero da serie de forma atomica e cria a nota como pendente. */
export function reservarNota(dados: {
  serie: number;
  destinatario: string;
  total: number;
  payload: string;
  regrasVersao: string;
}): { id: number; numero: number } {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { maior } = db
      .prepare("SELECT COALESCE(MAX(numero), 0) AS maior FROM notas WHERE serie = ? AND status IN ('autorizada', 'pendente')")
      .get(dados.serie) as { maior: number };
    const numero = maior + 1;
    const r = db
      .prepare(
        "INSERT INTO notas (numero, serie, status, destinatario, total, payload, regras_versao) VALUES (?, ?, 'pendente', ?, ?, ?, ?)"
      )
      .run(numero, dados.serie, dados.destinatario, dados.total, dados.payload, dados.regrasVersao);
    db.exec('COMMIT');
    return { id: Number(r.lastInsertRowid), numero };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function atualizarNota(
  id: number,
  campos: Partial<Pick<NotaRow, 'status' | 'chave' | 'protocolo' | 'cstat' | 'xmotivo' | 'xml_enviado' | 'xml_protocolado'>>
): void {
  const chaves = Object.keys(campos) as (keyof typeof campos)[];
  const sets = chaves.map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE notas SET ${sets}, atualizado_em = datetime('now') WHERE id = ?`)
    .run(...chaves.map((c) => campos[c] ?? null), id);
}

export function obterNota(id: number): NotaRow | null {
  return (db.prepare('SELECT * FROM notas WHERE id = ?').get(id) as NotaRow | undefined) ?? null;
}

export function listarNotas(limite = 10): NotaRow[] {
  return db.prepare('SELECT * FROM notas ORDER BY id DESC LIMIT ?').all(limite) as NotaRow[];
}

export function notasPendentes(): NotaRow[] {
  return db.prepare("SELECT * FROM notas WHERE status = 'pendente' AND chave IS NOT NULL ORDER BY id").all() as NotaRow[];
}
