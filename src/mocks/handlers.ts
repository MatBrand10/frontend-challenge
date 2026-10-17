import { http, HttpResponse } from 'msw';
import type { PathParams } from 'msw';
import { baseNfts } from '../data/mockData';
import { formatEth, parseEth, sumCart } from '../lib/eth';
import type { CartItem, Nft, Order, User } from '../types';
import { getMockScenario, mockScenarios, resetMockState, setMockScenario } from './scenarios';
import { publishNftUpdate, publishOrderUpdate } from './socket';

const STORAGE = {
  session: 'nft-marketplace-session',
  users: 'nft-marketplace-users',
  favorites: 'nft-marketplace-favorites',
  cart: 'nft-marketplace-cart',
  profile: 'nft-marketplace-profile',
  orders: 'nft-marketplace-orders',
};

type StoredUser = User & { passwordSalt: string; passwordHash: string };

const seededUsers: StoredUser[] = [
  {
    id: 'user-1',
    name: 'Nina Vale',
    email: 'demo@marketplace.io',
    passwordSalt: 'nft-marketplace-seed-v1',
    passwordHash: '7584a268ff0cc45b166fa22a491cffc880b22d4bc2900f21c67013444d1c1103',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=500&q=80',
    wallets: [
      { id: 'wallet-1', label: 'Primary wallet', network: 'Ethereum', address: '0xA1b2...A98C', isPrimary: true },
      { id: 'wallet-2', label: 'Backup wallet', network: 'Polygon', address: '0xC13d...41B7', isPrimary: false },
    ],
  },
  {
    id: 'user-2',
    name: 'Mateo Cruz',
    email: 'collector@marketplace.io',
    passwordSalt: 'nft-marketplace-second-seed-v1',
    passwordHash: '76705d78a960f50daa82c45a81ce6348bf6e7d21db8fdc44ea4cf066f0485f34',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
    wallets: [
      { id: 'wallet-3', label: 'Primary wallet', network: 'Ethereum', address: '0xF23a...8D91', isPrimary: true },
    ],
  },
];

const readJSON = <T>(key: string, fallback: T): T => {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJSON = <T>(key: string, value: T) => localStorage.setItem(key, JSON.stringify(value));
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let variableLatencyRequest = 0;

function getScenarioNfts(): Nft[] {
  const scenario = getMockScenario();
  return baseNfts.map((nft) => {
    if (nft.id !== 'nft-1') return nft;
    if (scenario === 'changed-price' || scenario === 'socket-price-change' || scenario === 'socket-stale-duplicate') {
      return { ...nft, price: '0.49' };
    }
    if (scenario === 'sold-out') return { ...nft, available: 0 };
    return nft;
  });
}

async function applyNetworkScenario(request: Request): Promise<Response | null> {
  const scenario = getMockScenario();
  if (scenario === 'offline') return Response.error();
  if (scenario === 'server-error') {
    return HttpResponse.json({ error: 'Mock service temporarily unavailable' }, { status: 503 });
  }
  if (scenario === 'slow-network') await wait(1800);
  if (scenario === 'variable-latency') {
    const query = new URL(request.url).searchParams.get('q') ?? '';
    const requestNumber = variableLatencyRequest++;
    await wait(query.toLowerCase() === 'chrome' ? 900 : requestNumber % 2 === 0 ? 500 : 80);
  }
  return null;
}

const scenarioHandlers = [
  http.get('/api/__mock/scenario', () => HttpResponse.json({ scenario: getMockScenario(), scenarios: mockScenarios })),
  http.put('/api/__mock/scenario', async ({ request }) => {
    const body = await request.json() as { scenario?: unknown };
    const scenario = setMockScenario(body.scenario);
    if (!scenario) return HttpResponse.json({ error: 'Unknown mock scenario' }, { status: 400 });

    if (scenario === 'socket-price-change') {
      const nft = getScenarioNfts().find((item) => item.id === 'nft-1');
      if (nft) {
        setTimeout(() => publishNftUpdate({ nftId: nft.id, price: nft.price, available: nft.available, version: 2 }), 100);
      }
    }
    if (scenario === 'socket-stale-duplicate') {
      setTimeout(() => {
        publishNftUpdate({ nftId: 'nft-1', price: '0.51', available: 3, version: 3 });
        publishNftUpdate({ nftId: 'nft-1', price: '0.49', available: 4, version: 2 });
        publishNftUpdate({ nftId: 'nft-1', price: '0.51', available: 3, version: 3 });
      }, 100);
    }
    return HttpResponse.json({ scenario });
  }),
  http.post('/api/__mock/reset', () => {
    resetMockState();
    variableLatencyRequest = 0;
    return HttpResponse.json({ scenario: 'default', reset: true });
  }),
];

function getUsers(): StoredUser[] {
  return readJSON<StoredUser[]>(STORAGE.users, seededUsers);
}

function saveUsers(users: StoredUser[]) {
  writeJSON(STORAGE.users, users);
}

function updateUser(nextUser: StoredUser) {
  saveUsers(getUsers().map((user) => user.id === nextUser.id ? nextUser : user));
}

async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 120_000 },
    key,
    256,
  );
  return Array.from(new Uint8Array(derived), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toPublicUser(user: StoredUser): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    wallets: user.wallets,
  };
}

const getUserId = () => {
  const session = readJSON<{ userId: string; token: string } | null>(STORAGE.session, null);
  return session?.userId ?? 'guest';
};

const scopedKey = (key: string, userId = getUserId()) => `${key}:${userId}`;

const getCurrentUser = (): StoredUser | null => {
  const session = readJSON<{ userId: string; token: string } | null>(STORAGE.session, null);
  if (!session) return null;
  return getUsers().find((user) => user.id === session.userId) ?? null;
};

const getFavorites = (): string[] => readJSON<string[]>(scopedKey(STORAGE.favorites), []);
const setFavorites = (favorites: string[]) => writeJSON(scopedKey(STORAGE.favorites), favorites);
const getCart = (userId?: string): CartItem[] => readJSON<CartItem[]>(scopedKey(STORAGE.cart, userId), [])
  .map((item) => {
    const nft = getScenarioNfts().find((entry) => entry.id === item.nftId);
    return nft ? { ...item, price: nft.price, available: nft.available } : item;
  });
const setCart = (cart: CartItem[], userId?: string) => writeJSON(scopedKey(STORAGE.cart, userId), cart);
const getOrders = (): Order[] => readJSON<Order[]>(scopedKey(STORAGE.orders), []);
const setOrders = (orders: Order[]) => writeJSON(scopedKey(STORAGE.orders), orders);
const consumeCartItems = (purchasedItems: CartItem[]) => {
  const remaining = getCart()
    .map((item) => {
      const purchased = purchasedItems.find((entry) => entry.nftId === item.nftId);
      return purchased ? { ...item, quantity: item.quantity - purchased.quantity } : item;
    })
    .filter((item) => item.quantity > 0);
  setCart(remaining);
};
const mergeVisitorCart = (userId: string) => {
  const guestCart = getCart('guest');
  if (guestCart.length === 0) return;

  const accountCart = getCart(userId);
  const merged = [...accountCart];
  guestCart.forEach((guestItem) => {
    const index = merged.findIndex((item) => item.nftId === guestItem.nftId);
    if (index >= 0) {
      merged[index] = { ...merged[index], quantity: Math.min(merged[index].available, merged[index].quantity + guestItem.quantity) };
    } else {
      merged.push({ ...guestItem, quantity: Math.min(guestItem.available, guestItem.quantity) });
    }
  });
  setCart(merged, userId);
  setCart([], 'guest');
};

const withAuth = (
  handler: (user: StoredUser, request: Request, params: Record<string, string | undefined>) => Response | Promise<Response>,
) => {
  return async ({ request, params }: { request: Request; params: PathParams }) => {
    const routeParams = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, typeof value === 'string' ? value : value?.[0]]),
    );
    const token = request.headers.get('Authorization');
    const session = readJSON<{ userId: string; token: string } | null>(STORAGE.session, null);
    if (getMockScenario() === 'expired-session') {
      localStorage.removeItem(STORAGE.session);
      localStorage.removeItem('nft-marketplace-token');
      return HttpResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    if (!token || !session || token !== `Bearer ${session.token}`) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = getCurrentUser();
    if (!user) return HttpResponse.json({ error: 'Session expired' }, { status: 401 });
    return handler(user, request, routeParams);
  };
};

export const handlers = [
  ...scenarioHandlers,
  http.get('/api/nfts', async ({ request }) => {
    const networkError = await applyNetworkScenario(request);
    if (networkError) return networkError;
    if (getMockScenario() === 'empty-catalog') {
      return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 3, totalPages: 1 });
    }
    const url = new URL(request.url);
    const query = url.searchParams.get('q') ?? '';
    const sort = url.searchParams.get('sort') ?? 'featured';
    const page = Number(url.searchParams.get('page') ?? '1');
    const collection = url.searchParams.get('collection') ?? 'all';

    let items: Nft[] = getScenarioNfts();

    if (query) {
      items = items.filter((nft) => `${nft.name} ${nft.collection} ${nft.artist}`.toLowerCase().includes(query.toLowerCase()));
    }

    if (collection !== 'all') {
      items = items.filter((nft) => nft.collection === collection);
    }

    if (sort === 'price-asc') items = [...items].sort((a, b) => parseEth(a.price) < parseEth(b.price) ? -1 : 1);
    if (sort === 'price-desc') items = [...items].sort((a, b) => parseEth(a.price) > parseEth(b.price) ? -1 : 1);
    if (sort === 'likes') items = [...items].sort((a, b) => b.likes - a.likes);

    const pageSize = 3;
    const paged = items.slice((page - 1) * pageSize, page * pageSize);

    return HttpResponse.json({ items: paged, total: items.length, page, pageSize, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) });
  }),

  http.get('/api/nfts/:id', async ({ params, request }) => {
    const networkError = await applyNetworkScenario(request);
    if (networkError) return networkError;
    const nft = getScenarioNfts().find((item) => item.id === params.id);
    if (!nft) {
      return HttpResponse.json({ error: 'NFT not found' }, { status: 404 });
    }

    return HttpResponse.json(nft);
  }),

  http.get('/api/session', () => {
    const session = readJSON<{ userId: string; token: string } | null>(STORAGE.session, null);
    if (!session) return HttpResponse.json({ user: null });
    const user = getUsers().find((item) => item.id === session.userId);
    return HttpResponse.json({ user: user ? toPublicUser(user) : null });
  }),

  http.post('/api/auth/login', async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string };
    const users = getUsers();
    const matchingUser = users.find((candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase());
    const passwordHash = matchingUser ? await hashPassword(password, matchingUser.passwordSalt) : '';
    const user = matchingUser?.passwordHash === passwordHash ? matchingUser : null;
    if (!user) {
      return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = `token-${user.id}`;
    const payload = { userId: user.id, token };
    writeJSON(STORAGE.session, payload);
    localStorage.setItem('nft-marketplace-token', token);
    mergeVisitorCart(user.id);
    return HttpResponse.json({ user: toPublicUser(user) });
  }),

  http.post('/api/auth/register', async ({ request }) => {
    const body = (await request.json()) as { name: string; email: string; password: string };
    const users = getUsers();
    const exists = users.some((user) => user.email.toLowerCase() === body.email.trim().toLowerCase());
    if (exists) {
      return HttpResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    if (body.name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.password.length < 8) {
      return HttpResponse.json({ error: 'Enter a name, valid email, and password with at least 8 characters' }, { status: 400 });
    }
    const passwordSalt = crypto.randomUUID();
    const newUser: StoredUser = {
      id: `user-${Date.now()}`,
      name: body.name.trim(),
      email: body.email.trim(),
      passwordSalt,
      passwordHash: await hashPassword(body.password, passwordSalt),
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
      wallets: [{ id: `wallet-${Date.now()}`, label: 'Wallet', network: 'Ethereum', address: '0xB12C...9AEF', isPrimary: true }],
    };
    saveUsers([...users, newUser]);
    const token = `token-${newUser.id}`;
    writeJSON(STORAGE.session, { userId: newUser.id, token });
    localStorage.setItem('nft-marketplace-token', token);
    mergeVisitorCart(newUser.id);
    return HttpResponse.json({ user: toPublicUser(newUser) });
  }),

  http.post('/api/auth/logout', () => {
    localStorage.removeItem('nft-marketplace-token');
    localStorage.removeItem(STORAGE.session);
    return HttpResponse.json({ ok: true });
  }),

  http.get('/api/favorites', withAuth((_user, _request, _params) => {
    const favs = getFavorites();
    return HttpResponse.json({ items: favs.filter((id) => baseNfts.some((nft) => nft.id === id)) });
  })),

  http.post('/api/favorites/:id', withAuth(async (user, request, params) => {
    const id = String(params.id ?? '');
    const existing = getFavorites();
    const next = existing.includes(id) ? existing.filter((item) => item !== id) : [...existing, id];
    setFavorites(next);
    return HttpResponse.json({ ok: true, favorite: next });
  })),

  http.delete('/api/favorites/:id', withAuth((user, _request, params) => {
    const next = getFavorites().filter((item) => item !== String(params.id));
    setFavorites(next);
    return HttpResponse.json({ ok: true, favorites: next });
  })),

  http.get('/api/cart', () => {
    const cart = getCart().map((item) => {
      const nft = getScenarioNfts().find((entry) => entry.id === item.nftId);
      return nft ? { ...item, price: nft.price, available: nft.available } : item;
    });
    setCart(cart);
    return HttpResponse.json({ items: cart });
  }),

  http.post('/api/cart', async ({ request }) => {
    const body = (await request.json()) as { nftId: string; quantity: number; price: string; name: string; image: string; available: number; edition: string };
    const nft = getScenarioNfts().find((entry) => entry.id === body.nftId);
    if (!nft) return HttpResponse.json({ error: 'NFT not found' }, { status: 404 });
    if (!Number.isInteger(body.quantity) || body.quantity < 1) {
      return HttpResponse.json({ error: 'Quantity must be a positive integer' }, { status: 400 });
    }

    const cart = getCart();
    const itemIndex = cart.findIndex((entry) => entry.nftId === body.nftId);
    const nextQuantity = (itemIndex >= 0 ? cart[itemIndex].quantity : 0) + body.quantity;
    if (nextQuantity > nft.available) {
      return HttpResponse.json({ error: 'Requested quantity is no longer available' }, { status: 409 });
    }

    if (itemIndex >= 0) {
      cart[itemIndex] = { ...cart[itemIndex], quantity: nextQuantity, price: nft.price, available: nft.available };
    } else {
      cart.push({ nftId: nft.id, quantity: body.quantity, name: nft.name, image: nft.image, price: nft.price, available: nft.available, edition: nft.edition });
    }

    setCart(cart);
    return HttpResponse.json({ items: cart });
  }),

  http.put('/api/cart/:nftId', async ({ request, params }) => {
    const body = (await request.json()) as { quantity: number };
    const nft = getScenarioNfts().find((entry) => entry.id === params.nftId);
    if (!nft) return HttpResponse.json({ error: 'NFT not found' }, { status: 404 });
    if (!Number.isInteger(body.quantity) || body.quantity < 1) {
      return HttpResponse.json({ error: 'Quantity must be a positive integer' }, { status: 400 });
    }
    if (body.quantity > nft.available) {
      return HttpResponse.json({ error: 'Requested quantity is no longer available' }, { status: 409 });
    }
    const cart = getCart().map((item) => item.nftId === params.nftId
      ? { ...item, quantity: body.quantity, price: nft.price, available: nft.available }
      : item);
    setCart(cart);
    return HttpResponse.json({ items: cart });
  }),

  http.delete('/api/cart/:nftId', ({ params }) => {
    const cart = getCart().filter((item) => item.nftId !== params.nftId);
    setCart(cart);
    return HttpResponse.json({ items: cart });
  }),

  http.post('/api/quote', async ({ request }) => {
    const networkError = await applyNetworkScenario(request);
    if (networkError) return networkError;
    const body = (await request.json()) as { items?: CartItem[]; coupon?: string };
    const items = getCart();
    if ((body.coupon && body.coupon !== 'SAVE10') || (getMockScenario() === 'invalid-coupon' && body.coupon)) {
      return HttpResponse.json({ error: 'Coupon is invalid or expired' }, { status: 400 });
    }
    if (body.items && JSON.stringify(body.items) !== JSON.stringify(items)) {
      return HttpResponse.json({ error: 'Cart changed. Refresh the quote before continuing.' }, { status: 409 });
    }
    const unavailable = items.find((item) => item.quantity > item.available || item.available < 1);
    if (unavailable) {
      return HttpResponse.json({ error: `${unavailable.name} no longer has enough available editions` }, { status: 409 });
    }
    const subtotal = sumCart(items);
    const discount = body.coupon === 'SAVE10' ? subtotal / 10n : 0n;
    const fee = subtotal > 0n ? parseEth('0.025') : 0n;
    const total = subtotal + fee - discount;

    return HttpResponse.json({
      subtotal: formatEth(subtotal),
      discount: formatEth(discount),
      networkFee: formatEth(fee),
      total: formatEth(total),
    });
  }),

  http.post('/api/orders', withAuth(async (user, request, _params) => {
    const body = (await request.json()) as {
      items: CartItem[];
      idempotencyKey: string;
      coupon?: string;
      walletId?: string;
      paymentOutcome?: 'approved' | 'rejected' | 'disconnected';
    };
    const fingerprint = JSON.stringify({
      items: body.items,
      coupon: body.coupon ?? '',
      walletId: body.walletId ?? '',
      paymentOutcome: body.paymentOutcome ?? 'approved',
    });
    const existing = getOrders().find((order) => order.id === body.idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        return HttpResponse.json({ error: 'Idempotency key was already used for a different order' }, { status: 409 });
      }
      return HttpResponse.json(existing, { status: 200 });
    }

    if (!body.idempotencyKey || body.items.length === 0) {
      return HttpResponse.json({ error: 'Order contents and an idempotency key are required' }, { status: 400 });
    }
    if ((body.coupon && body.coupon !== 'SAVE10') || (getMockScenario() === 'invalid-coupon' && body.coupon)) {
      return HttpResponse.json({ error: 'Coupon is invalid or expired' }, { status: 400 });
    }
    const cart = getCart();
    if (JSON.stringify(body.items) !== JSON.stringify(cart)) {
      return HttpResponse.json({ error: 'Cart changed. Review the updated quote before confirming.' }, { status: 409 });
    }
    const changedItem = body.items.find((item) => {
      const nft = getScenarioNfts().find((entry) => entry.id === item.nftId);
      return !nft || nft.price !== item.price || item.quantity > nft.available || item.quantity < 1;
    });
    if (changedItem) {
      return HttpResponse.json({ error: `Price or availability changed for ${changedItem.name}` }, { status: 409 });
    }
    if (!body.walletId || !user.wallets.some((wallet) => wallet.id === body.walletId)) {
      return HttpResponse.json({ error: 'Select a valid wallet before confirming the order' }, { status: 400 });
    }

    const subtotal = sumCart(body.items);
    const discount = body.coupon === 'SAVE10' ? subtotal / 10n : 0n;
    const fee = subtotal > 0n ? parseEth('0.025') : 0n;
    const total = subtotal + fee - discount;
    const order: Order = {
      id: body.idempotencyKey || `order-${Date.now()}`,
      status: body.paymentOutcome === 'rejected'
        ? 'failed'
        : body.paymentOutcome === 'disconnected' || getMockScenario() === 'pending-timeout'
          ? 'pending'
          : 'confirmed',
      total: formatEth(total),
      subtotal: formatEth(subtotal),
      discount: formatEth(discount),
      fee: formatEth(fee),
      items: body.items,
      transactionId: `0x${Math.random().toString(16).slice(2, 10)}`,
      createdAt: new Date().toISOString(),
      isIdempotent: true,
      requestFingerprint: fingerprint,
    };

    const orders = [...getOrders(), order];
    setOrders(orders);

    if (order.status === 'confirmed') consumeCartItems(body.items);
    if (order.status === 'pending') {
      setTimeout(() => publishOrderUpdate({
        orderId: order.id,
        userId: user.id,
        status: 'confirmed',
        version: 2,
      }), 5100);
    }
    if (getMockScenario() === 'pending-timeout') await wait(9000);

    return HttpResponse.json(order, { status: 201 });
  })),

  http.get('/api/orders/:id', withAuth((user, _request, params) => {
    const orders = getOrders();
    const index = orders.findIndex((order) => order.id === params.id);
    const target = orders[index];
    if (!target) return HttpResponse.json({ error: 'Order not found' }, { status: 404 });
    if (target.status === 'pending' && Date.now() - new Date(target.createdAt).getTime() >= 5000) {
      const confirmed = { ...target, status: 'confirmed' as const };
      orders[index] = confirmed;
      setOrders(orders);
      consumeCartItems(confirmed.items);
      publishOrderUpdate({ orderId: confirmed.id, userId: user.id, status: confirmed.status, version: 2 });
      return HttpResponse.json(confirmed);
    }
    return HttpResponse.json(target);
  })),

  http.get('/api/profile', withAuth((user) => HttpResponse.json({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, wallets: user.wallets } }))),

  http.put('/api/profile', withAuth(async (user, request, _params) => {
    const body = (await request.json()) as { name: string; email: string; avatar: string };
    const name = body.name.trim();
    const email = body.email.trim();
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return HttpResponse.json({ error: 'Enter a valid name and email address' }, { status: 400 });
    }
    if (getUsers().some((candidate) => candidate.id !== user.id && candidate.email.toLowerCase() === email.toLowerCase())) {
      return HttpResponse.json({ error: 'Email already in use' }, { status: 409 });
    }
    const nextUser = { ...user, name, email, avatar: body.avatar };
    updateUser(nextUser);
    return HttpResponse.json({ user: toPublicUser(nextUser) });
  })),

  http.put('/api/profile/password', withAuth(async (user, request, _params) => {
    const body = (await request.json()) as { currentPassword: string; newPassword: string };
    if (body.newPassword.length < 8) {
      return HttpResponse.json({ error: 'New password must contain at least 8 characters' }, { status: 400 });
    }
    const currentHash = await hashPassword(body.currentPassword, user.passwordSalt);
    if (currentHash !== user.passwordHash) {
      return HttpResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }
    const passwordSalt = crypto.randomUUID();
    updateUser({ ...user, passwordSalt, passwordHash: await hashPassword(body.newPassword, passwordSalt) });
    return HttpResponse.json({ ok: true });
  })),

  http.get('/api/wallets', withAuth((user) => HttpResponse.json({ wallets: user.wallets }))),

  http.post('/api/wallets', withAuth(async (user, request, _params) => {
    const body = (await request.json()) as { label: string; network: string; address: string; isPrimary?: boolean };
    if (body.label.trim().length < 2 || body.network.trim().length < 2 || body.address.trim().length < 8) {
      return HttpResponse.json({ error: 'Enter a wallet name, network, and valid address' }, { status: 400 });
    }
    const wallet = { id: `wallet-${Date.now()}`, label: body.label, network: body.network, address: body.address, isPrimary: body.isPrimary ?? user.wallets.length === 0 };
    const next = [
      ...user.wallets.map((entry) => ({ ...entry, isPrimary: wallet.isPrimary ? false : entry.isPrimary })),
      wallet,
    ];
    updateUser({ ...user, wallets: next });
    return HttpResponse.json({ wallet });
  })),

  http.put('/api/wallets/:id', withAuth(async (user, request, params) => {
    const body = (await request.json()) as { label: string; network: string; address: string; isPrimary: boolean };
    if (body.label.trim().length < 2 || body.network.trim().length < 2 || body.address.trim().length < 8) {
      return HttpResponse.json({ error: 'Enter a wallet name, network, and valid address' }, { status: 400 });
    }
    const wallets = user.wallets.map((wallet) => ({
      ...wallet,
      ...(wallet.id === params.id ? { ...body, label: body.label.trim(), network: body.network.trim(), address: body.address.trim() } : {}),
      isPrimary: wallet.id === params.id ? body.isPrimary : body.isPrimary ? false : wallet.isPrimary,
    }));
    updateUser({ ...user, wallets });
    return HttpResponse.json({ wallets });
  })),
];
