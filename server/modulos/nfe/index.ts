// Modulo NF-e (modelo 55): venda de mercadorias, transmitida a SEFAZ da UF.
import { config } from '../../config.ts';
import { obterNota } from '../../db.ts';
import { rotaCadastro } from '../../rotas.ts';
import type { Modulo } from '../tipos.ts';
import { mensagemInicial, processar } from './conversa.ts';
import { excluirProduto, listarProdutos, salvarProduto } from './produtos.ts';
import { danfe } from './sefaz/adapter.ts';

export const nfe: Modulo = {
  id: 'nfe',
  nome: 'NF-e',
  assunto: 'Venda de mercadorias',
  destino: `SEFAZ-${config.uf}`,
  mensagemInicial,
  processar,
  rotas(router) {
    router.get('/produtos', (_req, res) => res.json(listarProdutos()));
    router.post('/produtos', rotaCadastro(salvarProduto));
    router.delete('/produtos/:descricao', (req, res) => {
      excluirProduto(req.params.descricao);
      res.status(204).end();
    });

    router.get('/notas/:id/xml', (req, res) => {
      const n = obterNota(Number(req.params.id));
      const xml = n?.xml_protocolado ?? n?.xml_enviado;
      if (!n || !xml) {
        res.status(404).send('XML nao encontrado');
        return;
      }
      res.type('application/xml').attachment(`NFe-${n.chave ?? n.numero}.xml`).send(xml);
    });

    router.get('/notas/:id/danfe', async (req, res) => {
      const n = obterNota(Number(req.params.id));
      if (!n?.xml_protocolado) {
        res.status(404).send('DANFE disponivel somente para nota autorizada');
        return;
      }
      res.type('application/pdf').send(await danfe(n.xml_protocolado));
    });
  }
};
