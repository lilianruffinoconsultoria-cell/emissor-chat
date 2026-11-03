import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { buscarCep, buscarPorCnpj, excluirCliente, listarClientes, salvarCliente } from './cadastros.ts';
import { config, ROOT } from './config.ts';
import { listarMensagens, salvarMensagem } from './db.ts';
import { modulo, MODULOS } from './modulos/index.ts';
import type { Resposta } from './modulos/tipos.ts';
import { rotaCadastro } from './rotas.ts';

const app = express();
app.use(express.json({ limit: '64kb' }));

// Uma mensagem por vez, em todos os modulos: evita duas emissoes simultaneas e disputa pelo certificado.
let fila: Promise<unknown> = Promise.resolve();
function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const r = fila.then(fn, fn);
  fila = r.catch(() => undefined);
  return r;
}

app.get('/api/modulos', (_req, res) => {
  res.json(MODULOS.map(({ id, nome, assunto, destino }) => {
    const ultima = listarMensagens(id).at(-1);
    const dados = ultima ? (JSON.parse(ultima.dados) as Resposta) : null;
    return {
      id, nome, assunto, destino,
      ultima: dados ? { autor: ultima!.autor, texto: dados.texto, criadoEm: `${ultima!.criado_em}Z` } : null
    };
  }));
});

for (const m of MODULOS) {
  const router = express.Router();

  router.get('/mensagens', (_req, res) => {
    const linhas = listarMensagens(m.id);
    if (!linhas.length) {
      const inicial = m.mensagemInicial();
      salvarMensagem(m.id, 'bot', inicial);
      res.json([{ id: 0, autor: 'bot', ...inicial, criadoEm: new Date().toISOString() }]);
      return;
    }
    res.json(linhas.map((l) => ({ id: l.id, autor: l.autor, ...JSON.parse(l.dados), criadoEm: `${l.criado_em}Z` })));
  });

  router.post('/mensagens', async (req, res) => {
    const texto = String(req.body?.texto ?? '').trim().slice(0, 2000);
    if (!texto) {
      res.status(400).json({ erro: 'Mensagem vazia' });
      return;
    }
    try {
      const respostas: Resposta[] = await naFila(async () => {
        salvarMensagem(m.id, 'eu', { texto });
        const r = await m.processar(texto, req.body?.origem === 'menu');
        for (const msg of r) salvarMensagem(m.id, 'bot', msg);
        return r;
      });
      res.json(respostas);
    } catch (e) {
      console.error(`[${m.id}]`, (e as Error).message);
      const falha: Resposta = { texto: `⚠️ Algo deu errado: ${(e as Error).message.slice(0, 200)}` };
      salvarMensagem(m.id, 'bot', falha);
      res.json([falha]);
    }
  });

  m.rotas(router);
  app.use(`/api/${m.id}`, router);
}

// Clientes sao compartilhados: o destinatario de uma NF-e pode ser o tomador de uma NFS-e.
app.get('/api/clientes', (_req, res) => res.json(listarClientes()));
app.post('/api/clientes', rotaCadastro(salvarCliente));
app.delete('/api/clientes/:doc', (req, res) => {
  excluirCliente(req.params.doc);
  res.status(204).end();
});

app.get('/api/consulta/cnpj/:cnpj', async (req, res) => {
  const achado = await buscarPorCnpj(req.params.cnpj.replace(/\D/g, ''));
  if (achado) res.json(achado);
  else res.status(404).json({ erro: 'CNPJ não encontrado.' });
});

app.get('/api/consulta/cep/:cep', async (req, res) => {
  const achado = await buscarCep(req.params.cep);
  if (achado) res.json(achado);
  else res.status(404).json({ erro: 'CEP não encontrado.' });
});

app.use('/api', (req, res) => {
  res.status(404).json({ erro: modulo(req.path.split('/')[1] ?? '') ? 'Rota não encontrada.' : 'Módulo não encontrado.' });
});

const dist = join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

// So localhost: o servidor tem acesso ao certificado e nao possui login.
app.listen(config.porta, config.host, () => {
  console.log(`Emissor em http://${config.host}:${config.porta} (homologacao: NF-e SEFAZ-${config.uf}, NFS-e Nacional)`);
});
