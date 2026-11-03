// Modulo NFS-e (Padrao Nacional): prestacao de servicos, transmitida ao ADN / Sefin Nacional.
import { rotaCadastro } from '../../rotas.ts';
import type { Modulo } from '../tipos.ts';
import { mensagemInicial, processar } from './conversa.ts';
import { gerarDanfse, lerNfse } from './danfse.ts';
import { obterNfse } from './notas.ts';
import { buscarServicos, excluirServico, formatarCodigo, listarServicos, salvarServico, servicoNacional } from './servicos.ts';

export const nfse: Modulo = {
  id: 'nfse',
  nome: 'NFS-e',
  assunto: 'Prestação de serviços',
  destino: 'Sistema Nacional',
  mensagemInicial,
  processar,
  rotas(router) {
    router.get('/servicos', (_req, res) => res.json(listarServicos().map((s) => ({ ...s, nacional: servicoNacional(s.codigo)?.descricao }))));
    router.post('/servicos', rotaCadastro(salvarServico));
    router.delete('/servicos/:descricao', (req, res) => {
      excluirServico(req.params.descricao);
      res.status(204).end();
    });

    // Busca na lista nacional para o formulario de servico: por codigo ou por palavras.
    router.get('/lista-nacional', (req, res) => {
      const q = String(req.query.q ?? '').slice(0, 200);
      const codigo = q.replace(/\D/g, '');
      const exato = codigo.length >= 4 ? servicoNacional(codigo.length === 4 ? `${codigo}01` : codigo) : undefined;
      const achados = exato ? [exato] : buscarServicos(q, 8);
      res.json(achados.map((s) => ({ codigo: s.codigo, rotulo: formatarCodigo(s.codigo), descricao: s.descricao, bloqueado: Boolean(s.grupoObrigatorio) })));
    });

    router.get('/notas/:id/xml', (req, res) => {
      const n = obterNfse(Number(req.params.id));
      const xml = n?.xml_nfse ?? n?.xml_dps;
      if (!n || !xml) {
        res.status(404).send('XML nao encontrado');
        return;
      }
      res.type('application/xml').attachment(n.xml_nfse ? `NFSe-${n.chave}.xml` : `DPS-${n.numero}.xml`).send(xml);
    });

    router.get('/notas/:id/danfse', async (req, res) => {
      const n = obterNfse(Number(req.params.id));
      if (!n?.xml_nfse || !n.chave) {
        res.status(404).send('DANFSe disponivel somente para NFS-e gerada');
        return;
      }
      // Desde a NT 008 o DANFSe e gerado pelo emissor, nao mais pelo ADN.
      res.type('application/pdf').send(await gerarDanfse(lerNfse(n.xml_nfse, n.chave, n.status === 'cancelada')));
    });
  }
};
