// NFS-e emitidas: numeracao da DPS, situacao e XML, na tabela propria do modulo.
import { db } from '../../db.ts';

export type StatusNfse = 'autorizada' | 'rejeitada' | 'pendente' | 'erro' | 'cancelada';

export type NfseRow = {
  id: number;
  numero: number; // nDPS
  serie: number;
  status: StatusNfse;
  id_dps: string | null;
  chave: string | null; // 50 digitos, gerada pelo ADN
  numero_nfse: string | null; // nNFSe, numerado pelo Sistema Nacional
  codigo: string | null; // codigo do erro do ADN ou status HTTP
  motivo: string | null;
  tomador: string;
  total: number;
  xml_dps: string | null;
  xml_nfse: string | null;
  xml_cancelamento: string | null;
  regras_versao: string;
  criado_em: string;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS nfse (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero INTEGER NOT NULL,
    serie INTEGER NOT NULL,
    status TEXT NOT NULL,
    id_dps TEXT,
    chave TEXT,
    numero_nfse TEXT,
    codigo TEXT,
    motivo TEXT,
    tomador TEXT NOT NULL,
    total REAL NOT NULL,
    payload TEXT NOT NULL,
    xml_dps TEXT,
    xml_nfse TEXT,
    xml_cancelamento TEXT,
    regras_versao TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- DPS rejeitada pode ter o numero reaproveitado; gerada (mesmo cancelada) ou pendente nunca (E0014).
  CREATE UNIQUE INDEX IF NOT EXISTS ux_nfse_numero ON nfse (serie, numero)
    WHERE status IN ('autorizada', 'pendente', 'cancelada');
`);

const USADOS = "('autorizada', 'pendente', 'cancelada')";

/** Reserva o proximo numero da DPS de forma atomica e cria a nota como pendente. */
export function reservarNfse(dados: { serie: number; tomador: string; total: number; payload: string; regrasVersao: string }): { id: number; numero: number } {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { maior } = db
      .prepare(`SELECT COALESCE(MAX(numero), 0) AS maior FROM nfse WHERE serie = ? AND status IN ${USADOS}`)
      .get(dados.serie) as { maior: number };
    const numero = maior + 1;
    const r = db
      .prepare("INSERT INTO nfse (numero, serie, status, tomador, total, payload, regras_versao) VALUES (?, ?, 'pendente', ?, ?, ?, ?)")
      .run(numero, dados.serie, dados.tomador, dados.total, dados.payload, dados.regrasVersao);
    db.exec('COMMIT');
    return { id: Number(r.lastInsertRowid), numero };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

type Campos = Partial<Pick<NfseRow, 'status' | 'id_dps' | 'chave' | 'numero_nfse' | 'codigo' | 'motivo' | 'xml_dps' | 'xml_nfse' | 'xml_cancelamento'>>;

export function atualizarNfse(id: number, campos: Campos): void {
  const chaves = Object.keys(campos) as (keyof Campos)[];
  const sets = chaves.map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE nfse SET ${sets}, atualizado_em = datetime('now') WHERE id = ?`).run(...chaves.map((c) => campos[c] ?? null), id);
}

export const obterNfse = (id: number): NfseRow | null =>
  (db.prepare('SELECT * FROM nfse WHERE id = ?').get(id) as NfseRow | undefined) ?? null;

/** Quem emite conhece o numero da NFS-e; o numero da DPS fica de reserva. */
export const nfsePorNumero = (numero: number): NfseRow | null =>
  (db.prepare(`SELECT * FROM nfse WHERE status IN ${USADOS} AND (numero_nfse = ? OR (numero_nfse IS NULL AND numero = ?)) ORDER BY id DESC LIMIT 1`)
    .get(String(numero), numero) as NfseRow | undefined) ?? null;

export const listarNfse = (limite = 10): NfseRow[] =>
  db.prepare('SELECT * FROM nfse ORDER BY id DESC LIMIT ?').all(limite) as NfseRow[];

export const nfsePendentes = (): NfseRow[] =>
  db.prepare("SELECT * FROM nfse WHERE status = 'pendente' AND id_dps IS NOT NULL ORDER BY id").all() as NfseRow[];
