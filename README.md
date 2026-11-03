# Emissor Chat: NF-e e NFS-e por conversa

Emissor web gratuito em que a nota é emitida conversando, como no WhatsApp. Cada documento é uma conversa:

- **NF-e** (modelo 55, mercadorias), transmitida à SEFAZ-SP com [`@brasil-fiscal/nfe`](https://github.com/brasil-fiscal/nfe) (MIT).
- **NFS-e** (Padrão Nacional, serviços), transmitida ao Sistema Nacional (ADN / Sefin Nacional) com
  [`@brasil-fiscal/nfse`](https://github.com/brasil-fiscal/nfse) (MIT).

React + TypeScript no navegador, Node + Express no servidor e SQLite embutido. O visual segue o modelo de design
em `PROJETOS/EMISSOR-CHAT/modelo chat/Emissor-Chat` (tokens copiados em `src/tokens.css`).

**Opera somente em homologação** (na NFS-e, "produção restrita"). Produção está bloqueada em `server/config.ts`.

## Como rodar

Requer Node 24.22.1 ou mais novo.

```
npm install
npm run sefaz:check   # cria o .env a partir do .pfx da pasta acima e testa a SEFAZ
npm run build
npm start             # abre em http://127.0.0.1:3333
```

Para desenvolver: `npm run dev` (interface em http://127.0.0.1:5173). Testes: `npm test`.
Simular uma conversa no terminal: `npx tsx scripts/simular.ts [--nfse] "mensagem" "sim"`.

## Como usar

Escolha a conversa na lista: **NF-e · Venda de mercadorias** ou **NFS-e · Prestação de serviços**.

### NF-e

Escolha como preferir. **Pelo chat**, escreva a venda numa mensagem só e o emissor pergunta apenas o que faltar:

> 2 caixas de parafuso a 15,50 ncm 7318.15.00 para 12.345.678/0001-95 no pix

**Pelo menu**, toque no clipe (ou digite `menu`) para cadastrar produtos e destinatários. CNPJ e CEP preenchem o
formulário sozinhos, e "Usar na nota" leva o dado para a conversa. Produto cadastrado também funciona no chat só com
quantidade e nome: `2 sorvete de creme`.

A nota só é transmitida depois do seu "sim". Comandos: `notas`, `status`, `empresa`,
`diagnostico`, `consultar`, `cancelar`, `ie 123456789`, `ajuda`.

### NFS-e

Escreva o serviço numa mensagem só:

> consultoria tributária 1.500,00 para 12.345.678/0001-95

O emissor sugere o **código da lista nacional** (cTribNac) pela descrição, busca o tomador pelo CNPJ e pergunta o resto.
Tomador é opcional (`sem tomador`). Serviço usado volta pelo catálogo só com a descrição; pelo menu há a aba
Serviços, com busca na lista nacional, e Tomadores (os mesmos clientes da NF-e).

Comandos: `notas`, `status`, `empresa`, `diagnostico` (convênio do município), `consultar` (pendentes),
`cancelar nota 12` (evento e101101), `cancelar` (rascunho), `im 12345` ou `im não tenho`, `tributos 6`, `ajuda`.

## Situação atual

Primeira NF-e **autorizada de verdade** em 02/11/2026 na SEFAZ-SP, em homologação:
cStat 100, protocolo 135260009753806, chave 35261169390261000161550010000000011389305842.
A consulta posterior na SEFAZ confirmou o mesmo protocolo, e o XML final passa no schema oficial procNFe.

| Item | Situação |
|---|---|
| Conexão, assinatura e transmissão | Funcionando |
| Autorização, protocolo, XML autorizado e DANFE | Funcionando com emitente real (MEI, CRT 4) |
| Simples Nacional fora do MEI (CRT 1) | Autorização ainda não testada |
| Destinatário real diferente do emitente | Funcionando (nota 3, protocolo 135260009753922) |
| IBS/CBS no XML (`IBSCBS` por item e `IBSCBSTot`) | Funcionando: aceito em homologação para MEI |
| Menu de cadastro de produtos e destinatários | Funcionando |

### Reforma Tributária

Cada item leva CST 000 e cClassTrib 000001, com IBS UF 0,10%, IBS municipal 0,00% e CBS 0,90% (ano-teste 2026), em
tabela versionada em `server/fiscal/regras.ts`. Os valores são informativos e não entram no total da nota.
Para CRT 1 e 4 o grupo é opcional hoje (a regra UB12-10 só obriga CRT 3) e a tributação começa em 2027.

O bloco no DANFE é provisório: a NT 2025.002 (item 9) informa que o layout oficial ainda está em estudo.
A biblioteca publicada gera o grupo em leiaute antigo; `server/sefaz/xml.ts` completa `vIBS` e os créditos presumidos.

### Certificado ativo

O certificado e o emitente ficam no `.env` (`PFX_PATH`, `PFX_SENHA`, `EMITENTE_CNPJ`). IE, regime e endereço
do emitente vêm da própria SEFAZ. O CNPJ precisa estar habilitado: o da Lilian Ruffino Consultoria recebeu
257 e 209, e a configuração dele está em `.env.lilian`. O `.env` atual é o do MEI João Victor. Depois de trocar, rode `npx tsx scripts/reset-teste.ts`.

## Arquitetura

Cada documento fiscal é um **módulo** independente em `server/modulos/<id>/`, que cumpre o contrato de
`server/modulos/tipos.ts`: nome, mensagem inicial, `processar(texto)` e rotas próprias em `/api/<id>`. O servidor
(`server/index.ts`) só conhece esse contrato e o registro em `server/modulos/index.ts`. Para um documento novo
(NFC-e, CT-e), crie a pasta e registre ali.

| Pasta | Responsabilidade |
|---|---|
| `server/modulos/nfe` | NF-e: conversa, parser de mercadorias, produtos, motor e regras (`fiscal/`), SEFAZ (`sefaz/`), DANFE |
| `server/modulos/nfse` | NFS-e: conversa, parser de serviços, lista nacional, motor e regras da DPS, ADN (`adn/`), DANFSe, tabela `nfse` |
| `server/comum` | Emitente (dados da empresa) e certificado A1, usados pelos dois módulos |
| `server/chat/parser.ts` | Texto comum: CPF/CNPJ, valores, CEP, sim/não |
| `server/cadastros.ts` | Clientes compartilhados (destinatário da NF-e = tomador da NFS-e) |
| `server/integracoes` | Consultas públicas de CNPJ (inclui opção pelo MEI) e CEP |
| `server/db.ts` | Mensagens por módulo, cadastros, notas da NF-e e auditoria em `data/emissor.db` |
| `src` | Interface: lista de conversas (`App.tsx`), conversa (`Conversa.tsx`), cadastros por módulo |

Cada módulo tem numeração, tabela e conversa próprias: um rascunho de NF-e não interfere no de NFS-e.

Decisões de segurança e confiabilidade:

- Número reservado em transação; rejeitado é reaproveitado, autorizado ou pendente nunca.
- Sem resposta da SEFAZ, a nota fica pendente e não é reenviada; use `consultar`.
- Servidor escuta só em `127.0.0.1`, porque tem acesso ao certificado e não tem login.
- Senha do certificado só no `.env`, ignorado pelo Git.

## NFS-e: situação e regras

**Primeira NFS-e autorizada de verdade** em 03/11/2026, na produção restrita: MEI João Victor Felix Rodrigues Costa
(CNPJ 69.390.261/0001-61, Ribeirão Preto/SP, município conveniado), NFS-e nº 1, serviço 16.02.01, R$ 150,00, sem
tomador, chave 35434022269390261000161000000000000126119222393632. A consulta pelo Id da DPS devolveu a mesma
chave e o mesmo XML.

Antes, com o certificado da Lilian Ruffino Consultoria
(ME/EPP, Avaré/SP): conexão mTLS, assinatura e schema aceitos; **rejeitada por E0037**, porque Avaré ainda não tem
convênio ativo com o Sistema Nacional (`diagnostico` mostra a mensagem oficial). Fora do MEI, empresa de município sem
convênio emite no sistema da prefeitura; não há o que corrigir na DPS. Para ver uma NFS-e autorizada é preciso um
emitente MEI ou de município conveniado (ex.: Belo Horizonte, 3106200).

O que a transmissão real mostrou e já está tratado:

- A produção restrita usa leiaute mais novo que o de produção (NT 009, `esquemas_prod_restrita_20261020.zip`):
  `finNFSe` obrigatório dentro de `infDPS`, logo após `tpEmit` (regra `finNFSeNaDps` em `regras.ts`).
  A primeira tentativa, sem ele, voltou E1235.
- O erro do ADN vem como `erros: [{ codigo, descricao, complemento }]`, em minúsculas; a biblioteca lê `Codigo` e perdia
  o código. `adn/adapter.ts` lê os dois formatos.
- Parâmetros municipais ficam em `adn.producaorestrita.nfse.gov.br/parametrizacao/{município}/convenio`, não na Sefin.
- A API de DANFSe do ADN foi suspensa em 03/08/2026 (NT 008 v1.02) e a Sefin responde 501. O PDF é gerado pelo
  emissor (`danfse.ts`): página única A4, QR Code da consulta pública, texto de autenticidade e
  "NFS-e SEM VALIDADE JURÍDICA" em homologação. A disposição dos quadros ainda é simplificada em relação à NT 008.

As DPS geradas (MEI com tomador CNPJ e endereço, MEI sem tomador, ME/EPP com CPF), assinadas, passam no XSD da
produção restrita de 20/10/2026 e no de produção de 09/02/2026.

Regras aplicadas, do Anexo I v1.01 (aba RN DPS_NFS-e), em `server/modulos/nfse/motor.ts`:

| Regime | Como sai a DPS |
|---|---|
| MEI | `opSimpNac` 2, sem IM, sem `regApTribSN` (E0162), `regEspTrib` 0 (E0174), sem retenção (E0583), `indTotTrib` 0 (E0710) |
| ME/EPP | `opSimpNac` 3, `regApTribSN` 1 (E0166), IM se a prefeitura tiver (E0116/E0120), `pTotTribSN` obrigatório (E0712) |
| Não optante | Bloqueado: o emissor recusa antes de montar a DPS |

- Regime vem da base pública do CNPJ (opção pelo Simples e pelo MEI), porque empresa só de serviço costuma não ter IE.
- Endereço do tomador vai no XML com CNPJ (E0235) e quando o ISS é devido no tomador (E0234); a biblioteca não gera esse grupo,
  `adn/xml.ts` o insere antes da assinatura. O mesmo arquivo troca a versão da DPS para 1.01.
- Lista nacional (338 códigos), incidência do ISS e grupos obrigatórios (obra/evento) vêm dos anexos oficiais, em
  `lista-servicos.json`. Códigos que exigem obra ou evento são recusados.
- Competência na data do Brasil (E0015) e emissão com 60 s de folga contra relógio adiantado (E0008).
- Sem resposta ou com HTTP 5xx, a NFS-e fica **pendente** e não é reenviada; `consultar` pergunta ao ADN pelo Id da DPS
  (`GET /dps/{id}`). Número de DPS gerada, pendente ou cancelada nunca é reaproveitado (E0014).
- O transporte da biblioteca não tem tempo limite: `adn/adapter.ts` usa um próprio, de 45 s.
- Grupo IBS/CBS da DPS **não é enviado**: é opcional em 2026 e, se informado, exige o código NBS (E0322), que o chat
  ainda não pergunta.
- Local da prestação é sempre o município do prestador; o chat ainda não pergunta outro local.

## Antes de pensar em produção

- O `.pfx` tem a senha no nome do arquivo, e a senha é igual aos 8 primeiros dígitos do CNPJ. Troque a senha.
- A biblioteca não valida o certificado TLS do servidor da SEFAZ (`rejectUnauthorized: false`). É preciso
  instalar a cadeia ICP-Brasil e ativar a verificação.
- Falta validação XSD local antes do envio; hoje quem valida é a SEFAZ.
- `indPres` está fixo em presencial, porque a biblioteca não gera `indIntermed`.
- Regras tributárias cobrem Simples Nacional e MEI, CSOSN 102, CFOP 5102, 6102 e 6108. IBS/CBS são informados como opcionais
  (NT 2025.002-RTC v1.53, pág. 7).
- CST 000 e cClassTrib 000001 são padrão para todos os produtos: conferir a classificação de cada NCM.
- As alíquotas de 2026 vieram de fontes secundárias: confirmar na legislação antes de usar em produção.
- DANFE: sem paginação para muitos itens. `server/danfe/gerador.ts` depende de caminhos internos da biblioteca.
- A numeração é uma só por série, não separada por emitente.
- NF-e, ainda não implementado: NFC-e, cancelamento, CC-e, inutilização e contingência.
- NFS-e: transmitir de verdade em produção restrita e conferir o formato de erro do ADN e o Id do evento de cancelamento
  (a biblioteca está em beta e avisa que esses detalhes precisam de validação). Falta substituição de NFS-e, intermediário,
  retenção de ISS, deduções, exportação, obra e evento.
