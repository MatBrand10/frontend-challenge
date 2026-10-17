# Architecture and API contracts

## Structure and runtime

- `src/App.tsx`: TanStack Router screens, TanStack Query state, and Socket.IO subscriptions.
- `src/api/client.ts`: the single Axios instance, API prefix and bearer-token injection.
- `src/mocks/handlers.ts`: MSW REST contracts, validation, fixtures and browser-persisted mock state.
- `src/mocks/scenarios.ts`: finite scenario catalogue, selection and reset logic.
- `src/mocks/socket.ts`: MSW WebSocket handler and Socket.IO protocol adapter.
- `src/data/mockData.ts`: deterministic NFT catalogue fixture.
- `src/lib/eth.ts`: decimal ETH parsing, formatting and aggregation with `BigInt`.

`src/main.tsx` starts MSW before dynamically importing the application. This ordering matters: `socket.io-client` captures the WebSocket constructor during module evaluation, so loading it before the MSW WebSocket interceptor is active would bypass the mock. In demo mode, REST is handled by the browser MSW worker. Socket.IO WebSockets are intercepted in the page by MSW's `WebSocketInterceptor`; `@mswjs/socket.io-binding` encodes/decodes Engine.IO and Socket.IO packets for the real `socket.io-client`.

No mock server depends on a private API, DNS entry, external websocket process or production backend. Setting `VITE_ENABLE_MOCKS=false` disables this local contract and requires a compatible REST/Socket.IO backend.

## REST contracts

Every REST request uses Axios with an 8-second timeout and the `VITE_API_BASE_URL` prefix (`/api` by default). Monetary values are decimal ETH strings in transport; quantities are integers.

| Method and path | Auth | Request / response shape |
| --- | --- | --- |
| `GET /session` | No | `{ user: User \| null }`; restores the browser session |
| `POST /auth/login` | No | `{ email, password }` → `{ user }`; invalid credentials return 401 |
| `POST /auth/register` | No | `{ name, email, password }` → `{ user }`; validation 400, duplicate email 409 |
| `POST /auth/logout` | No | Clears token/session → `{ ok: true }` |
| `GET /nfts?q&collection&sort&page` | No | `{ items, total, page, pageSize, totalPages }`; empty results are a successful empty page |
| `GET /nfts/:id` | No | `Nft`; unknown ID returns 404 |
| `GET /favorites` | Yes | `{ items: string[] }` |
| `POST /favorites/:id` | Yes | Toggle favorite → `{ ok, favorite }` |
| `DELETE /favorites/:id` | Yes | Remove favorite → `{ ok, favorites }` |
| `GET /cart` | No | `{ items: CartItem[] }`; current fixture price/availability is reconciled into each item |
| `POST /cart` | No | `{ nftId, quantity }` → `{ items }`; invalid quantity 400, insufficient stock 409 |
| `PUT /cart/:nftId` | No | `{ quantity }` → `{ items }`; invalid quantity 400, insufficient stock 409 |
| `DELETE /cart/:nftId` | No | `{ items }` |
| `POST /quote` | No | Optional `{ coupon, items }` → `{ subtotal, discount, networkFee, total }`; invalid coupon 400, changed cart/stock 409 |
| `POST /orders` | Yes | `{ items, idempotencyKey, coupon?, walletId, paymentOutcome }` → immutable `Order` snapshot |
| `GET /orders/:id` | Yes | `{ ...Order }`; pending orders are reconciled to their terminal status |
| `GET /profile` | Yes | `{ user }` |
| `PUT /profile` | Yes | `{ name, email, avatar }` → `{ user }`; validation 400, email conflict 409 |
| `PUT /profile/password` | Yes | `{ currentPassword, newPassword }` → success or validation/auth error |
| `GET /wallets` | Yes | `{ wallets }` |
| `POST /wallets` | Yes | `{ label, network, address, isPrimary }` → `{ wallets }` |
| `PUT /wallets/:id` | Yes | Update wallet → `{ wallets }`; invalid data 400, missing wallet 404 |
| `GET /__mock/scenario` | No | `{ scenario, scenarios }` |
| `PUT /__mock/scenario` | No | `{ scenario }` → selected scenario; invalid value 400 |
| `POST /__mock/reset` | No | Clears all `nft-marketplace-*` browser state → `{ scenario: "default", reset: true }` |

`User` includes `id`, `name`, `email`, `avatar`, and `wallets`. `CartItem` carries `nftId`, `quantity`, `name`, `image`, current `price`, current `available`, and `edition`. An `Order` snapshots `id`, terminal/pending `status`, `total`, `subtotal`, `discount`, `fee`, purchased `items`, simulated `transactionId`, `createdAt`, and an internal request fingerprint.

Expected error status classes are 400 (validation/coupon), 401 (missing/expired session), 404 (unknown NFT/order/wallet), 409 (duplicate account, stale quote, insufficient inventory, idempotency conflict), 503 (selected service outage), or a rejected network request (`offline`). No UI code invents successful API responses.

## Session and account isolation

The demo token and session live in `localStorage` under `nft-marketplace-token` and `nft-marketplace-session`. The authorization header is `Bearer <token>`. The mock stores account password salts and PBKDF2 hashes, not submitted passwords. The fixed public demo users are fixtures, not secure production identities.

Favorites, cart and orders are scoped to the active account ID. A visitor cart is stored under a guest scope and merged into the signed-in cart after login, with each quantity capped at available inventory. Logout clears the TanStack Query cache. Login/account switching clears previous cache entries before writing the new session. Socket subscriptions are recreated for the active user and private `order.updated` messages are ignored unless `userId` matches.

Private screens are protected by TanStack Router's session guard. The intended return route is held in `sessionStorage` and restored after successful login. An expired mock session returns 401 on the next protected API call; route guards prevent exposing cached private views after session invalidation.

## Cart and order lifecycle

Cart state can start as guest state and is persisted in browser localStorage. The mock re-reads NFT price and inventory for cart reads, quotes and order validation; a cached cart price never overrides a current API quote. `POST /quote` is authoritative for subtotal, coupon discount, network fee and total. `formatEth`, `parseEth`, and `sumCart` use integer base units (`BigInt`) and do not use floating-point arithmetic.

Checkout re-quotes immediately before submitting. A stale cart, price, coupon or inventory returns a conflict; checkout invalidates the cart/quote and asks the user to review. A stable fingerprint of cart, coupon, wallet and outcome maps to a `sessionStorage` idempotency key. Repeating the same payload recovers the same order; reusing its key with different contents returns 409. Pending orders are polled from REST; only confirmed orders consume purchased quantities. Failed payments preserve the cart. Receipt content comes from the stored order snapshot, not current NFT catalog values.

## Cache and asynchronous state

TanStack Query uses 20-second `staleTime`, one query retry, and disables focus-triggered re-fetches by default. Query keys include catalog URL parameters, NFT ID, session-scoped resources, cart and quote contents, and order ID. Mutation success invalidates the resources it changes. Favorite toggles optimistically update cache and restore the previous value on error.

The WebSocket connect/reconnect handler invalidates catalog, NFT and cart queries so REST reconciles state after event loss. Socket events are versioned by resource and session. Versions less than or equal to the last applied version are discarded. On account change, the socket is disposed/recreated and event-version state resets. Pending orders continue to reconcile via the REST order endpoint, including after page refresh or a socket interruption.

## Socket.IO event contracts

Events are emitted by the mock using MSW's WebSocket interceptor and `@mswjs/socket.io-binding`; the application always consumes them through `socket.io-client`. The mock link uses a synthetic `wss://marketplace.mock` URL intercepted before any DNS or external request.

| Event | Payload | Client behavior |
| --- | --- | --- |
| `nft.updated` | `{ nftId, price, available, version }` (optional `userId` for scoped fixtures) | Ignore old/duplicate versions; patch matching catalog/detail/cart cache entries; announce the update for assistive technology |
| `order.updated` | `{ orderId, userId, status, version }`, where status is `pending`, `confirmed`, or `failed` | Ignore wrong-user/old events; invalidate `['order', orderId]`; announce status. REST provides the authoritative order snapshot |

Order states are pending, confirmed or failed. Confirmed/failed are terminal in the mock; the client never changes a terminal result based solely on an event. A pending order can be recovered by querying REST after reconnect or refresh.

## Scenario fixtures

Scenario selection is persisted under `nft-marketplace-mock-scenario`, so it survives refresh. `POST /api/__mock/reset` removes only app-prefixed localStorage entries and restores default fixtures. Scenarios cover empty catalog, fixed/variable latency, offline, 503, expired session, invalid coupon, stale price, sold-out stock, delayed response after order creation, Socket.IO price update and stale/duplicate event versions. See the reproduction steps in [README.md](./README.md).

## UX, accessibility and deviations

- The current UI is a marketplace approximation, not a verified pixel match to Figma. The workspace did not include the Figma export/assets; images remain remote Unsplash URLs. Validate spacing, typography and assets against the linked source before claiming visual parity.
- Desktop and responsive mobile layouts use Tailwind CSS and semantic controls. Loading placeholders, empty/error feedback, keyboard focus styles, labels, route fallback and `aria-live` for realtime messages are included.
- The brief requests shadcn/ui. Components use Radix primitives where present and hand-authored Tailwind UI; the current screen set does not use a generated shadcn/ui component library.
- Simulated wallet/payment controls exist for demonstration; they do not represent real chain submission or transaction finality.
- Lighthouse configuration and report generation are provided, but scores remain environment-dependent; see the measured report output after running the documented audit command.

## Production boundary

Vercel serves the static Vite build and SPA fallback. Browser-local mock state is deliberately only a self-contained evaluation/demo mode: it is not an authenticated production backend, not durable storage, and not a production-grade password/payment system. Keep `VITE_ENABLE_MOCKS=true` only for the public demo. A real deployment must supply the compatible REST and Socket.IO server and keep all secrets server-side.
