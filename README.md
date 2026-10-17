# NFT Marketplace — entrega do desafio

Aplicação React + TypeScript para o desafio [Frontend Challenge — Marketplace de NFTs](https://github.com/MatBrand10/frontend-challenge). Este README documenta a solução e a execução local; consulte também [ARCHITECTURE.md](./ARCHITECTURE.md) para decisões e contratos.

## Requisitos

- Node.js 20 ou superior e npm.
- Chromium para Playwright.
- Chrome/Chromium instalado para Lighthouse. Se não estiver no caminho padrão, defina `CHROME_PATH`.

## Instalação e execução

```bash
npm ci
npx playwright install chromium
npm run dev
```

O MSW é habilitado por padrão em desenvolvimento e no build de demonstração. A aplicação só é carregada depois da inicialização do worker para que o interceptor do MSW instale-se antes de `socket.io-client`.

Comandos disponíveis:

| Comando | Objetivo |
| --- | --- |
| `npm run dev` | Desenvolvimento com APIs e Socket.IO simulados |
| `npm run build` | Type-check incremental e build Vite de produção |
| `npm run preview` | Servir localmente o conteúdo otimizado em `dist/` |
| `npm run typecheck` | Executar somente a verificação TypeScript |
| `npm run lint` | Executar ESLint |
| `npm run test:e2e` | Playwright em Chromium desktop e mobile |
| `npm run test:e2e:report` | Abrir o relatório HTML do Playwright |
| `npm run audit:lighthouse` | Fazer 3 medições por página e perfil e calcular medianas |

## Variáveis de ambiente

Copie `.env.example` para `.env.local` se quiser sobrescrever os padrões:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `VITE_ENABLE_MOCKS` | `true` | `false` desativa o MSW; nesse caso, é necessário um backend compatível |
| `VITE_API_BASE_URL` | `/api` | Prefixo REST usado pelo Axios |
| `VITE_SOCKET_URL` | vazio | Vazio usa o Socket.IO mockado via MSW; preenchido aponta para um servidor Socket.IO compatível |
| `LIGHTHOUSE_URL` | `http://127.0.0.1:4173` | Origem do preview de produção auditado |
| `CHROME_PATH` | descoberta automática | Caminho do executável Chrome/Chromium para Lighthouse |

Variáveis `VITE_*` são incluídas no JavaScript público. Nunca coloque chaves, senhas reais ou credenciais privadas nelas. O modo mock não é um backend de produção: dados ficam no navegador e não sincronizam entre dispositivos.

## Contas fictícias

| E-mail | Senha |
| --- | --- |
| `demo@marketplace.io` | `demo123` |
| `collector@marketplace.io` | `collector123` |

O cadastro gera salt e hash PBKDF2 no mock. As contas acima são fixtures públicas de demonstração; não reutilize senhas pessoais. O cupom válido padrão é `SAVE10`.

## Cenários MSW: selecionar, reproduzir e redefinir

Os controles de cenário são endpoints de mock, disponíveis somente quando os mocks estão ativos. Selecione um cenário no Console do navegador na origem da aplicação:

```js
await fetch('/api/__mock/scenario', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ scenario: 'server-error' }),
});
```

Lista de valores aceitos:

| Cenário | Efeito reproduzível |
| --- | --- |
| `default` | Fixtures normais |
| `empty-catalog` | Catálogo sem resultados |
| `slow-network` | Latência fixa de 1,8 s em catálogo, detalhe e cotação |
| `variable-latency` | Atrasos variáveis e resposta de busca `Chrome` mais lenta |
| `offline` | Falha de conexão em catálogo, detalhe e cotação |
| `server-error` | HTTP 503 em catálogo, detalhe e cotação |
| `expired-session` | Requests autenticados retornam HTTP 401 e removem a sessão mock |
| `invalid-coupon` | Cupom informado na cotação/pedido é rejeitado |
| `changed-price` | `nft-1` passa a custar `0.49 ETH`; o servidor rejeita pedido com cotação antiga |
| `sold-out` | Disponibilidade de `nft-1` passa a zero |
| `pending-timeout` | Cria pedido pendente, atrasa a resposta além do timeout Axios e permite recuperar pela chave idempotente |
| `socket-price-change` | Emite `nft.updated` para `nft-1` usando Socket.IO e altera preço para `0.49 ETH` |
| `socket-stale-duplicate` | Emite versão 3, uma versão antiga 2 e uma duplicata 3 |

Como reproduzir erros:

1. Carregue a aplicação e selecione `server-error` ou `offline` no console.
2. Atualize a página; o catálogo deve exibir erro. Selecione `default` e use **Try again** para validar recuperação.
3. Para testar sessão, faça login, selecione `expired-session` e abra perfil/carteiras/checkout; o próximo request autenticado recebe 401.
4. Para testar cotação, adicione `nft-1` ao carrinho, selecione `changed-price` ou `sold-out` e prossiga ao checkout. A confirmação com preço/disponibilidade antigos deve ser impedida.
5. Para eventos, deixe o catálogo, detalhe ou carrinho aberto e selecione `socket-price-change`; a alteração chega pelo cliente Socket.IO e aparece na região acessível de status. `socket-stale-duplicate` valida descarte por versão.
6. Para timeout, entre no checkout e confirme uma compra com o cenário `pending-timeout`. Aguarde o timeout de rede e confirme novamente; a tentativa idempotente recupera o mesmo pedido.

Redefina integralmente as fixtures e a sessão/carrinho locais com:

```js
await fetch('/api/__mock/reset', { method: 'POST' });
location.reload();
```

O reset remove somente chaves `nft-marketplace-*` do `localStorage`. Cenários ativos não devem ser usados com `VITE_ENABLE_MOCKS=false`.

## Contratos REST e Socket.IO

O Axios usa `/api`; as rotas e respostas simuladas estão em `src/mocks/handlers.ts`. O contrato detalhado, os estados de erro, a sessão, o carrinho, o cache e a reconciliação estão em [ARCHITECTURE.md](./ARCHITECTURE.md).

Eventos Socket.IO aceitos:

- `nft.updated`: `{ nftId, price, available, version }`. O cliente atualiza catálogo, detalhe e carrinho em cache, ignora versões antigas/duplicadas e anuncia a mudança.
- `order.updated`: `{ orderId, userId, status, version }`. Só é aplicado à sessão correspondente; invalida a consulta REST do pedido.

O mock usa o `WebSocketInterceptor` do MSW e `@mswjs/socket.io-binding` para exercitar o `socket.io-client` com o protocolo Socket.IO sem DNS ou servidor externo. Em reconexão, o cliente invalida recursos ativos e consulta novamente o REST. Pedidos pendentes são recuperados pela rota REST e pela mesma chave idempotente.

## Playwright

```bash
npm run test:e2e
npm run test:e2e:report
```

Os testes isolam estado via reset de fixtures e exercitam desktop/mobile Chromium: busca, detalhe direto e inexistente, rotas privadas, login/retomada, compra, recusa de pagamento, erros/recuperação de API, cenários vazios, evento Socket.IO e descarte de evento obsoleto/duplicado. Relatórios e traces de falha são gerados pelo Playwright.

## Auditoria Lighthouse

Em um terminal, gere e sirva o build de produção:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Em outro terminal:

```bash
npm run audit:lighthouse
```

O script audita início e detalhe em mobile (390 px) e desktop (1440 px), com três medições por combinação. Grava HTML/JSON de cada execução e `reports/lighthouse/summary.json`, contendo medianas de Performance, Accessibility, Best Practices, SEO, LCP, CLS e TBT, além das versões/ambiente. Se o Chrome não for descoberto automaticamente, configure `CHROME_PATH`; use `LIGHTHOUSE_URL` para outra origem de preview.

Metas do enunciado: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95 e SEO ≥ 90. O script reporta resultados e medianas; não os mascara nem garante que as metas sejam atingidas.

Última medição local do preview de produção (Chrome 154, três execuções por combinação):

| Página | Perfil | Performance | Accessibility | Best Practices | SEO | LCP mediano | CLS mediano |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Início | Mobile | 78 | 100 | 100 | 100 | 2663 ms | 0.000 |
| Início | Desktop | 100 | 100 | 100 | 100 | 622 ms | 0.000 |
| Detalhe NFT | Mobile | 83 | 100 | 100 | 100 | 3086 ms | 0.000 |
| Detalhe NFT | Desktop | 95 | 100 | 100 | 100 | 694 ms | 0.139 |

Acessibilidade, boas práticas e SEO atingiram as metas nesta execução. Performance mobile permanece abaixo da meta de 90. Lighthouse atribuiu o principal custo a execução JavaScript e trabalho na thread principal: bootup mediano de 1,8 s na página inicial e 1,3 s no detalhe, TBT de 568 ms/335 ms, além de aproximadamente 33 KiB de JavaScript não utilizado e 150 ms de economia potencial em recursos bloqueantes. A maior parte do bootup foi atribuída ao chunk `mock-vendor`, necessário para manter os mocks funcionais na demonstração publicada. Os valores variam conforme navegador, CPU e rede; execute novamente no ambiente de avaliação antes de usar esses números como resultado final.

## Deploy Vercel

`vercel.json` configura `npm ci`, `npm run build`, saída `dist` e fallback SPA. Importe o repositório Git no Vercel, mantenha a raiz do projeto e configure `VITE_ENABLE_MOCKS=true` em Preview e Production. Não são necessárias variáveis privadas.

Depois do deploy, teste acesso direto e refresh em `/`, `/nft/nft-1`, `/cart`, `/login` e `/checkout`. O Socket.IO mock roda no navegador; não exige processo persistente na Vercel. Se configurar `VITE_SOCKET_URL`, o endpoint precisa ser um servidor Socket.IO acessível por HTTPS/WSS e compatível com os eventos documentados.

## Limitações conhecidas

- Pagamentos, sessão e persistência são simulações locais, sem serviço de pagamento, blockchain ou banco de dados.
- As imagens são URLs externas do Unsplash; nenhum pacote de assets do Figma foi fornecido. A fidelidade visual precisa ser conferida contra o Figma original.
- A suíte Playwright é uma smoke/regression suite, não cobre todos os 12 grupos do enunciado nem inclui baselines visuais versionadas.
- Performance Lighthouse mobile ainda não alcançou a meta de 90 nesta máquina; relatórios completos são gerados localmente pelo comando e podem variar no ambiente alvo.
- O mock Socket.IO testa o protocolo no browser, mas não substitui teste de interoperabilidade contra o backend real.
