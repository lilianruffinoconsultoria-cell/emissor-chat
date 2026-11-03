import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.EMISSOR_DATA_DIR ?? join(ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });

if (!process.env.PFX_PATH) {
  try {
    process.loadEnvFile(join(ROOT, '.env'));
  } catch {
    // Testes rodam sem .env; a emissao real falha com mensagem clara em certificado().
  }
}

// Producao fica bloqueada de proposito: este emissor so transmite em homologacao.
if ((process.env.AMBIENTE ?? 'homologacao') !== 'homologacao') {
  throw new Error('AMBIENTE invalido: este emissor opera somente em homologacao.');
}

export const config = {
  pfxPath: process.env.PFX_PATH ?? '',
  pfxSenha: process.env.PFX_SENHA ?? '',
  uf: process.env.UF ?? 'SP',
  ambiente: 'homologacao' as const,
  porta: Number(process.env.PORT ?? 3333),
  host: '127.0.0.1'
};
