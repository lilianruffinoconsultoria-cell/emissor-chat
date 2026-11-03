# Emissor NF-e por chat

Emissor web gratuito de NF-e (modelo 55) em que a nota é emitida conversando, como no WhatsApp.
React + TypeScript no navegador, Node + Express no servidor, SQLite embutido e
[`@brasil-fiscal/nfe`](https://github.com/brasil-fiscal/nfe) (MIT) na comunicação com a SEFAZ.

**Opera somente em homologação.** Produção está bloqueada em `server/config.ts`.

## Como rodar

Requer Node 24.22.1 ou mais novo.

```
npm install
npm run sefaz:check   # cria o .env a partir do .pfx da pasta acima e testa a SEFAZ
npm run build
npm start             # abre em http://127.0.0.1:3333
```

Para desenvolver: `npm run dev` (interface em http://127.0.0.1:5173). Testes: `npm test`.

## Como usar

Escolha como preferir. **Pelo chat**, escreva a venda numa mensagem só e o emissor pergunta apenas o que faltar:

> 2 caixas de parafuso a 15,50 ncm 7318.15.00 para 12.345.678/0001-95 no pix

**Pelo menu**, toque em **+** (ou digite `menu`) para cadastrar produtos e destinatários. CNPJ e CEP preenchem o
formulário sozinhos, e "Usar na nota" leva o dado para a conversa. Produto cadastrado também funciona no chat só com
quantidade e nome: `2 sorvete de creme`.

A nota só é transmitida depois do seu "sim". Comandos: `notas`, `status`, `empresa`,
`diagnostico`, `consultar`, `cancelar`, `ie 123456789`, `ajuda`.

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
257 e 209, e a configuração dele está em `.env.lilian`. Depois de trocar, rode `npx tsx scripts/reset-teste.ts`.

## Arquitetura

| Pasta | Responsabilidade |
|---|---|
| `server/chat` | Interpretação do texto e condução da conversa |
| `server/fiscal` | Motor fiscal e regras versionadas, sem conhecer a SEFAZ |
| `server/sefaz` | Único ponto que fala com os web services e lê o certificado |
| `server/integracoes` | Consultas públicas de CNPJ e CEP |
| `server/db.ts` | Notas, numeração, cadastros e auditoria em `data/emissor.db` |
| `src` | Interface de chat |

Decisões de segurança e confiabilidade:

- Número reservado em transação; rejeitado é reaproveitado, autorizado ou pendente nunca.
- Sem resposta da SEFAZ, a nota fica pendente e não é reenviada; use `consultar`.
- Servidor escuta só em `127.0.0.1`, porque tem acesso ao certificado e não tem login.
- Senha do certificado só no `.env`, ignorado pelo Git.

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
- Ainda não implementado: NFC-e, cancelamento, CC-e, inutilização e contingência.
