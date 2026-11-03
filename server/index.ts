import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import { config, ROOT } from './config.ts';
import { db, obterNota } from './db.ts';
import {
  buscarCep,
  buscarPorCnpj,
  ErroCadastro,
  excluirCliente,
  excluirProduto,
  listarClientes,
  listarProdutos,
  salvarCliente,
  salvarProduto
} from './cadastros.ts';
import { mensagemInicial, processar, type Resposta } from './chat/engine.ts';
import { danfe } from './sefaz/adapter.ts';

const app = express();
app.use(express.json({ limit: '64kb' }));

const salvar = (autor: 'eu' | 'bot', dados: unknown) =>
  db.prepare('INSERT INTO mensagens (autor, dados) VALUES (?, ?)').run(autor, JSON.stringify(dados));

// Uma mensagem por vez: evita duas emissoes simultaneas a partir do mesmo rascunho.
let fila: Promise<unknown> = Promise.resolve();
function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const r = fila.then(fn, fn);
  fila = r.catch(() => undefined);
  return r;
}

app.get('/api/mensagens', (_req, res) => {
  const linhas = db.prepare('SELECT id, autor, dados, criado_em FROM mensagens ORDER BY id').all() as {
    id: number; autor: string; dados: string; criado_em: string;
  }[];
  if (!linhas.length) {
    const inicial = mensagemInicial();
    salvar('bot', inicial);
    res.json([{ id: 0, autor: 'bot', ...inicial, criadoEm: new Date().toISOString() }]);
    return;
  }
  res.json(linhas.map((l) => ({ id: l.id, autor: l.autor, ...JSON.parse(l.dados), criadoEm: `${l.criado_em}Z` })));
});

app.post('/api/mensagens', async (req, res) => {
  const texto = String(req.body?.texto ?? '').trim().slice(0, 2000);
  if (!texto) {
    res.status(400).json({ erro: 'Mensagem vazia' });
    return;
  }
  try {
    const respostas: Resposta[] = await naFila(async () => {
      salvar('eu', { texto });
      const r = await processar(texto, req.body?.origem === 'menu');
      for (const m of r) salvar('bot', m);
      return r;
    });
    res.json(respostas);
  } catch (e) {
    console.error('[chat]', (e as Error).message);
    const falha: Resposta = { texto: `⚠️ Algo deu errado: ${(e as Error).message.slice(0, 200)}` };
    salvar('bot', falha);
    res.json([falha]);
  }
});

app.get('/api/cadastros', (_req, res) => {
  res.json({ produtos: listarProdutos(), clientes: listarClientes() });
});

function salvarCadastro(req: Request, res: Response, salvar: (dados: Record<string, unknown>) => unknown) {
  try {
    res.json(salvar(req.body ?? {}));
  } catch (e) {
    if (e instanceof ErroCadastro) res.status(422).json({ erro: e.message });
    else throw e;
  }
}

app.post('/api/produtos', (req, res) => salvarCadastro(req, res, salvarProduto));
app.post('/api/clientes', (req, res) => salvarCadastro(req, res, salvarCliente));

app.delete('/api/produtos/:descricao', (req, res) => {
  excluirProduto(req.params.descricao);
  res.status(204).end();
});

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

app.get('/api/notas/:id/xml', (req, res) => {
  const n = obterNota(Number(req.params.id));
  const xml = n?.xml_protocolado ?? n?.xml_enviado;
  if (!n || !xml) {
    res.status(404).send('XML nao encontrado');
    return;
  }
  res.type('application/xml').attachment(`NFe-${n.chave ?? n.numero}.xml`).send(xml);
});

app.get('/api/notas/:id/danfe', async (req, res) => {
  const n = obterNota(Number(req.params.id));
  if (!n?.xml_protocolado) {
    res.status(404).send('DANFE disponivel somente para nota autorizada');
    return;
  }
  res.type('application/pdf').send(await danfe(n.xml_protocolado));
});

const dist = join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

// So localhost: o servidor tem acesso ao certificado e nao possui login.
app.listen(config.porta, config.host, () => {
  console.log(`Emissor em http://${config.host}:${config.porta} (homologacao ${config.uf})`);
});
