import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  Link,
  useNavigate,
  useParams,
  useSearch,
  Navigate,
} from '@tanstack/react-router';
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ChevronRight, Heart, LogOut, Menu, Minus, Plus, Search, ShoppingBag } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { api } from './api/client';
import { baseNfts } from './data/mockData';
import { formatEth, sumCart } from './lib/eth';
import { cn } from './lib/utils';
import type { CartItem, Nft, User, Wallet } from './types';

type CatalogSearch = { q: string; collection: string; page: number; sort: string };

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="rounded-[32px] border border-slate-200 bg-white p-8 text-center text-slate-700 shadow-soft">
      This page does not exist. <Link to="/" className="font-semibold text-slate-900">Return home</Link>
    </div>
  ),
});

function getApiError(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ error?: string }>(error)) {
    return error.response?.data?.error ?? error.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function isUnauthorized(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

async function establishSession(queryClient: QueryClient, user: User) {
  await queryClient.cancelQueries();
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  queryClient.setQueryData(['session'], user);
}

function RootLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cartQuery = useQuery({ queryKey: ['cart'], queryFn: async () => (await api.get('/cart')).data.items ?? [] });
  const sessionQuery = useQuery({ queryKey: ['session'], queryFn: async () => (await api.get('/session')).data.user ?? null });
  const favoritesQuery = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => (await api.get('/favorites')).data.items ?? [],
    enabled: !!sessionQuery.data,
  });
  const sessionUserId = sessionQuery.data?.id ?? null;

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');
  const eventVersions = useRef(new Map<string, number>());

  useEffect(() => {
    const handleSessionExpired = () => {
      if (!['/login', '/register'].includes(window.location.pathname)) {
        sessionStorage.setItem('nft-marketplace-return-to', `${window.location.pathname}${window.location.search}`);
      }
      queryClient.clear();
      void navigate({ to: '/login', replace: true });
    };
    window.addEventListener('marketplace:session-expired', handleSessionExpired);
    return () => window.removeEventListener('marketplace:session-expired', handleSessionExpired);
  }, [navigate, queryClient]);

  useEffect(() => {
    const mocksEnabled = import.meta.env.VITE_ENABLE_MOCKS !== 'false';
    const socketUrl = import.meta.env.VITE_SOCKET_URL || (mocksEnabled ? 'https://marketplace.mock' : '');
    if (!socketUrl) return;

    eventVersions.current.clear();
    const isBrowserMock = mocksEnabled && socketUrl === 'https://marketplace.mock';
    const socket = io(socketUrl, {
      reconnection: true,
      ...(isBrowserMock ? { transports: ['websocket'] as const } : {}),
    });

    socket.on('connect', () => {
      void queryClient.invalidateQueries({ queryKey: ['nfts'] });
      void queryClient.invalidateQueries({ queryKey: ['nft'] });
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
    });
    socket.on('nft.updated', (payload: { nftId: string; price: string; available: number; version: number; userId?: string }) => {
      if (payload.userId && payload.userId !== sessionUserId) return;
      const eventKey = `${sessionUserId ?? 'public'}:${payload.nftId}`;
      const lastVersion = eventVersions.current.get(eventKey) ?? 0;
      if (payload.version <= lastVersion) return;
      eventVersions.current.set(eventKey, payload.version);

      queryClient.setQueriesData<{ items: Nft[] }>({ queryKey: ['nfts'] }, (existing) => {
        if (!existing) return existing;
        return {
          ...existing,
          items: existing.items.map((nft) => nft.id === payload.nftId
            ? { ...nft, price: payload.price, available: payload.available }
            : nft),
        };
      });
      queryClient.setQueryData<Nft>(['nft', payload.nftId], (existing) => existing
        ? { ...existing, price: payload.price, available: payload.available }
        : existing);
      queryClient.setQueryData<CartItem[]>(['cart'], (existing) => existing?.map((item) => item.nftId === payload.nftId
        ? { ...item, price: payload.price, available: payload.available }
        : item));
      setLiveMessage(`${payload.nftId} updated: ${payload.price} ETH, ${payload.available} available.`);
    });
    socket.on('order.updated', (payload: { orderId: string; userId: string; status: 'pending' | 'confirmed' | 'failed'; version: number }) => {
      if (payload.userId !== sessionUserId) return;
      const eventKey = `${sessionUserId}:${payload.orderId}`;
      const lastVersion = eventVersions.current.get(eventKey) ?? 0;
      if (payload.version <= lastVersion) return;
      eventVersions.current.set(eventKey, payload.version);
      void queryClient.invalidateQueries({ queryKey: ['order', payload.orderId] });
      setLiveMessage(`Order ${payload.orderId} is ${payload.status}.`);
    });

    return () => {
      socket.disconnect();
    };
  }, [queryClient, sessionUserId]);

  const logout = async () => {
    await api.post('/auth/logout');
    queryClient.clear();
    window.location.href = '/';
  };

  const user = sessionQuery.data;
  const cartCount = (cartQuery.data ?? []).reduce((sum: number, item: CartItem) => sum + item.quantity, 0);
  const favoritesCount = (favoritesQuery.data ?? []).length;

  return (
    <div className="min-h-screen bg-[#f5f2ee] text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-[#f5f2ee]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8">
          <Link to="/" className="flex items-center gap-3 text-lg font-semibold">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-sm font-bold text-white">NFT</div>
            <span>Marketplace</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-slate-600 md:flex">
            <Link to="/" className="hover:text-slate-900">Home</Link>
            <Link to="/cart" className="hover:text-slate-900">Cart</Link>
            <Link to="/profile" className="hover:text-slate-900">Profile</Link>
            <Link to="/wallets" className="hover:text-slate-900">Wallets</Link>
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Link to="/" className="relative rounded-full border border-slate-200 bg-white p-2 text-slate-700">
              <Heart className="h-5 w-5" />
              {favoritesCount > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-[#f59e0b] px-1.5 text-[10px] text-white">{favoritesCount}</span>}
            </Link>
            <Link to="/cart" className="relative rounded-full border border-slate-200 bg-white p-2 text-slate-700">
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-[#7c3aed] px-1.5 text-[10px] text-white">{cartCount}</span>}
            </Link>
            {user ? (
              <>
                <Link to="/profile" className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium">
                  <img src={user.avatar} alt={user.name} className="h-7 w-7 rounded-full object-cover" />
                  {user.name}
                </Link>
                <button aria-label="Sign out" onClick={logout} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300">
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link to="/login" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium">Login</Link>
                <Link to="/register" className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white">Create account</Link>
              </div>
            )}
          </div>

          <button aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'} className="rounded-full border border-slate-200 bg-white p-2 md:hidden" onClick={() => setIsMobileMenuOpen((open) => !open)}>
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {isMobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 py-3 md:hidden">
            <div className="flex flex-col gap-3 text-sm text-slate-700">
              <Link to="/" onClick={() => setIsMobileMenuOpen(false)}>Home</Link>
              <Link to="/cart" onClick={() => setIsMobileMenuOpen(false)}>Cart</Link>
              <Link to="/profile" onClick={() => setIsMobileMenuOpen(false)}>Profile</Link>
              <Link to="/wallets" onClick={() => setIsMobileMenuOpen(false)}>Wallets</Link>
              {user && <button aria-label="Sign out" onClick={logout} className="text-left">Sign out</button>}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <div className="sr-only" aria-live="polite">{liveMessage}</div>
        <Outlet />
      </main>
    </div>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string | undefined) ?? '',
    collection: (search.collection as string | undefined) ?? 'all',
    page: Number(search.page ?? 1),
    sort: (search.sort as string | undefined) ?? 'featured',
  }),
});

const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nft/$id',
  component: DetailPage,
});

const confirmationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/confirmation/$orderId',
  component: () => <ProtectedRoute><ConfirmationPage /></ProtectedRoute>,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  detailRoute,
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/cart',
    component: CartPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/checkout',
    component: () => <ProtectedRoute><CheckoutPage /></ProtectedRoute>,
  }),
  confirmationRoute,
  loginRoute,
  registerRoute,
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/profile',
    component: () => <ProtectedRoute><ProfilePage /></ProtectedRoute>,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/wallets',
    component: () => <ProtectedRoute><WalletsPage /></ProtectedRoute>,
  }),
]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: async () => (await api.get('/session')).data.user ?? null,
  });

  if (sessionQuery.isLoading) {
    return <div className="rounded-[32px] bg-white p-8 text-slate-500 shadow-soft">Checking your session…</div>;
  }

  if (!sessionQuery.data) {
    sessionStorage.setItem('nft-marketplace-return-to', `${window.location.pathname}${window.location.search}`);
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function HomePage() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/' }) as { q: string; collection: string; page: number; sort: string };
  const [query, setQuery] = useState(search.q || '');
  const [collection, setCollection] = useState(search.collection || 'all');
  const [sort, setSort] = useState(search.sort || 'featured');

  useEffect(() => {
    setQuery(search.q || '');
    setCollection(search.collection || 'all');
    setSort(search.sort || 'featured');
  }, [search]);

  const nftsQuery = useQuery({
    queryKey: ['nfts', { q: search.q, collection: search.collection, page: search.page, sort: search.sort }],
    queryFn: async () => {
      const { data } = await api.get('/nfts', { params: { q: search.q, collection: search.collection, page: search.page, sort: search.sort } });
      return data;
    },
  });

  const submitSearch = () => {
    navigate({
      to: '/',
      search: (prev: CatalogSearch) => ({ ...prev, q: query, collection, page: 1, sort }),
    });
  };

  const pageCount = nftsQuery.data?.totalPages ?? 1;
  const currentPage = nftsQuery.data?.page ?? 1;

  return (
    <div className="space-y-8">
      <section className="rounded-[32px] bg-gradient-to-r from-[#0f172a] via-[#1f2937] to-[#4f46e5] p-6 text-white shadow-soft md:p-10">
        <div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr] md:items-end">
          <div>
            <p className="mb-4 text-sm uppercase tracking-[0.22em] text-slate-200">Curated drops</p>
            <h1 className="max-w-md text-4xl font-semibold leading-tight md:text-5xl">Discover the next must-own collection.</h1>
            <p className="mt-4 max-w-xl text-slate-200">Explore rare digital art, utility assets and collector pieces with secure checkout and live inventory updates.</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            <p className="text-sm text-slate-200">Featured collection</p>
            <div className="mt-4 flex items-center justify-between">
              <div>
                <div className="text-3xl font-semibold">Aurora Bloom</div>
                <p className="text-slate-200">Neon Garden</p>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-2 text-sm font-medium">0.42 ETH</div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submitSearch()}
              placeholder="Search collections or artists"
              aria-label="Search NFTs"
            />
          </div>

          <select aria-label="Filter by collection" value={collection} onChange={(event) => setCollection(event.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none">
            <option value="all">All collections</option>
            <option value="Neon Garden">Neon Garden</option>
            <option value="Velocity">Velocity</option>
            <option value="Waveform">Waveform</option>
          </select>

          <select aria-label="Sort NFTs" value={sort} onChange={(event) => setSort(event.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none">
            <option value="featured">Featured</option>
            <option value="likes">Most liked</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>

          <button onClick={submitSearch} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white">Apply filters</button>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Marketplace</h2>
          <div className="text-sm text-slate-600">{nftsQuery.data?.total ?? baseNfts.length} results</div>
        </div>

        {nftsQuery.isLoading ? (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="animate-pulse overflow-hidden rounded-3xl border border-slate-200 bg-white">
                <div className="h-64 bg-slate-200" />
                <div className="space-y-3 p-5">
                  <div className="h-4 w-24 rounded bg-slate-200" />
                  <div className="h-6 w-40 rounded bg-slate-200" />
                  <div className="h-4 w-full rounded bg-slate-200" />
                </div>
              </div>
            ))}
          </div>
        ) : nftsQuery.isError ? (
          <div role="alert" className="rounded-3xl border border-red-200 bg-white p-8 text-center text-red-700">
            <p>{getApiError(nftsQuery.error, 'Could not load the catalog.')}</p>
            <button onClick={() => void nftsQuery.refetch()} className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Try again</button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {(nftsQuery.data?.items ?? []).map((nft: Nft) => (
              <NftCard key={nft.id} nft={nft} />
            ))}
            {nftsQuery.data?.items?.length === 0 && <p className="col-span-full rounded-3xl bg-white p-8 text-center text-slate-600">No NFTs match these filters.</p>}
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-50"
            disabled={currentPage <= 1}
            onClick={() => navigate({ to: '/', search: (prev: CatalogSearch) => ({ ...prev, page: Math.max(1, currentPage - 1) }) })}
          >Previous</button>
          <span className="text-sm font-medium">Page {currentPage} / {pageCount}</span>
          <button
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-50"
            disabled={currentPage >= pageCount}
            onClick={() => navigate({ to: '/', search: (prev: CatalogSearch) => ({ ...prev, page: Math.min(pageCount, currentPage + 1) }) })}
          >Next</button>
        </div>
      </section>
    </div>
  );
}

function NftCard({ nft }: { nft: Nft }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: async () => (await api.get('/session')).data.user ?? null,
  });
  const favoritesQuery = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => (await api.get('/favorites')).data.items as string[],
    enabled: !!sessionQuery.data,
  });
  const [favoriteError, setFavoriteError] = useState('');
  const liked = favoritesQuery.data?.includes(nft.id) ?? false;

  const toggleFavorite = async () => {
    setFavoriteError('');
    const previous = favoritesQuery.data ?? [];
    const next = liked ? previous.filter((id) => id !== nft.id) : [...previous, nft.id];
    queryClient.setQueryData(['favorites'], next);
    try {
      await api.post(`/favorites/${nft.id}`);
      await queryClient.invalidateQueries({ queryKey: ['favorites'] });
    } catch (error) {
      queryClient.setQueryData(['favorites'], previous);
      if (isUnauthorized(error)) {
        sessionStorage.setItem('nft-marketplace-return-to', `${window.location.pathname}${window.location.search}`);
        await navigate({ to: '/login' });
      } else {
        setFavoriteError(getApiError(error, 'Could not update favorite.'));
      }
    }
  };

  return (
    <article className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-soft">
      <div className="relative">
        <img src={nft.image} alt={nft.name} className="h-64 w-full object-cover" />
        <button
          type="button"
          onClick={toggleFavorite}
          aria-label={liked ? `Remove ${nft.name} from favorites` : `Add ${nft.name} to favorites`}
          className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-slate-800 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <Heart className={cn('h-5 w-5', liked && 'fill-red-500 text-red-500')} />
        </button>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
          <span>{nft.collection}</span>
          <span>{nft.available} available</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">{nft.name}</h3>
            <p className="text-sm text-slate-500">by {nft.artist}</p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{nft.price} ETH</div>
        </div>
        <div className="flex gap-2">
          {nft.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{tag}</span>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-500">{nft.likes} likes</div>
          <Link to={`/nft/${nft.id}`} className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            View NFT <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {favoriteError && <p role="alert" className="text-sm text-red-600">{favoriteError}</p>}
      </div>
    </article>
  );
}

function DetailPage() {
  const { id } = useParams({ from: '/nft/$id' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nftQuery = useQuery({ queryKey: ['nft', id], queryFn: async () => (await api.get(`/nfts/${id}`)).data });
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [actionError, setActionError] = useState('');
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: async () => (await api.get('/session')).data.user ?? null,
  });
  const favoritesQuery = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => (await api.get('/favorites')).data.items as string[],
    enabled: !!sessionQuery.data,
  });

  const addToCart = async () => {
    if (!nftQuery.data) return;
    setActionError('');
    setIsAdding(true);
    try {
      await api.post('/cart', {
        nftId: nftQuery.data.id,
        quantity,
        price: nftQuery.data.price,
        name: nftQuery.data.name,
        image: nftQuery.data.image,
        available: nftQuery.data.available,
        edition: nftQuery.data.edition,
      });
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      await navigate({ to: '/cart' });
    } catch (error) {
      setActionError(getApiError(error, 'Could not add this NFT to your cart.'));
    } finally {
      setIsAdding(false);
    }
  };

  const toggleFavorite = async () => {
    if (!nftQuery.data) return;
    setActionError('');
    const previous = favoritesQuery.data ?? [];
    const isFavorite = previous.includes(nftQuery.data.id);
    queryClient.setQueryData(['favorites'], isFavorite
      ? previous.filter((favoriteId) => favoriteId !== nftQuery.data.id)
      : [...previous, nftQuery.data.id]);
    try {
      await api.post(`/favorites/${nftQuery.data.id}`);
      await queryClient.invalidateQueries({ queryKey: ['favorites'] });
    } catch (error) {
      queryClient.setQueryData(['favorites'], previous);
      if (isUnauthorized(error)) {
        sessionStorage.setItem('nft-marketplace-return-to', `${window.location.pathname}${window.location.search}`);
        await navigate({ to: '/login' });
      } else {
        setActionError(getApiError(error, 'Could not update favorite.'));
      }
    }
  };

  if (nftQuery.isLoading) return <div className="h-[540px] animate-pulse rounded-3xl bg-white p-8" aria-label="Loading NFT details" />;
  if (nftQuery.isError) {
    return (
      <div role="alert" className="rounded-3xl bg-white p-8 text-red-600">
        <p>{axios.isAxiosError(nftQuery.error) && nftQuery.error.response?.status === 404 ? 'NFT not found.' : getApiError(nftQuery.error, 'Could not load NFT details.')}</p>
        <button onClick={() => void nftQuery.refetch()} className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm text-white">Try again</button>
      </div>
    );
  }
  if (!nftQuery.data) return <div role="alert" className="rounded-3xl bg-white p-8 text-red-500">NFT data is unavailable.</div>;

  const nft = nftQuery.data as Nft;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white p-4 shadow-soft">
        <img src={nft.image} alt={nft.name} className="h-[540px] w-full rounded-[28px] object-cover" />
      </div>

      <div className="space-y-6 rounded-[32px] border border-slate-200 bg-white p-6 shadow-soft">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
          <span>{nft.collection}</span>
          <ChevronRight className="h-4 w-4" />
          <span>{nft.edition}</span>
        </div>
        <h1 className="text-4xl font-semibold">{nft.name}</h1>
        <p className="text-lg text-slate-500">by {nft.artist}</p>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <Heart className="h-4 w-4 text-red-400" /> {nft.likes} likes
        </div>
        <div className="rounded-2xl bg-slate-100 p-4">
          <div className="text-sm text-slate-600">Current price</div>
          <div className="mt-2 text-3xl font-semibold">{nft.price} ETH</div>
        </div>

        <div className="flex items-center gap-3">
          <button aria-label="Decrease quantity" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="rounded-full border border-slate-200 p-3"><Minus className="h-4 w-4" /></button>
          <span className="w-12 text-center text-lg font-medium">{quantity}</span>
          <button aria-label="Increase quantity" disabled={quantity >= nft.available} onClick={() => setQuantity((q) => Math.min(nft.available, q + 1))} className="rounded-full border border-slate-200 p-3 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
        </div>

        <div className="flex gap-3">
          <button disabled={isAdding || nft.available < 1} onClick={addToCart} className="flex-1 rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-50">{isAdding ? 'Adding…' : 'Add to cart'}</button>
          <button aria-pressed={favoritesQuery.data?.includes(nft.id) ?? false} onClick={toggleFavorite} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">{favoritesQuery.data?.includes(nft.id) ? 'Saved' : 'Save'}</button>
        </div>
        {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}

        <div className="space-y-3 text-sm text-slate-600">
          <p>{nft.description}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            {nft.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{tag}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CartPage() {
  const queryClient = useQueryClient();
  const cartQuery = useQuery({ queryKey: ['cart'], queryFn: async () => (await api.get('/cart')).data.items ?? [] });
  const quoteQuery = useQuery({
    queryKey: ['quote', 'cart', cartQuery.data],
    queryFn: async () => (await api.post('/quote', {})).data,
    enabled: !!cartQuery.data?.length,
  });
  const [updateError, setUpdateError] = useState('');

  const updateQuantity = async (nftId: string, quantity: number) => {
    setUpdateError('');
    try {
      if (quantity <= 0) {
        await api.delete(`/cart/${nftId}`);
      } else {
        await api.put(`/cart/${nftId}`, { quantity });
      }
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      await queryClient.invalidateQueries({ queryKey: ['quote'] });
    } catch (error) {
      setUpdateError(getApiError(error, 'Could not update your cart.'));
    }
  };

  if (cartQuery.isLoading) {
    return <div className="h-72 animate-pulse rounded-[32px] bg-white shadow-soft" aria-label="Loading cart" />;
  }

  if (!cartQuery.data || cartQuery.data.length === 0) {
    return <div className="rounded-[32px] bg-white p-8 text-center text-slate-600 shadow-soft">Your cart is empty. <Link className="text-indigo-600" to="/">Explore the collection</Link></div>;
  }

  const hasAvailabilityIssue = cartQuery.data.some((item: CartItem) => item.quantity > item.available || item.available < 1);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-4">
        {updateError && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{updateError}</p>}
        {(cartQuery.data ?? []).map((item: CartItem) => (
          <div key={item.nftId} className="flex items-center gap-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-soft">
            <img src={item.image} alt={item.name} className="h-24 w-24 rounded-2xl object-cover" />
            <div className="flex-1">
              <div className="text-lg font-semibold">{item.name}</div>
              <div className="text-sm text-slate-500">{item.edition}</div>
              <div className="text-xs text-slate-500">{item.available} available</div>
              <div className="mt-2 flex items-center gap-3">
                <button aria-label={`Decrease ${item.name} quantity`} onClick={() => updateQuantity(item.nftId, item.quantity - 1)} className="rounded-full border border-slate-200 p-2"><Minus className="h-4 w-4" /></button>
                <span className="w-5 text-center text-sm font-medium">{item.quantity}</span>
                <button aria-label={`Increase ${item.name} quantity`} disabled={item.quantity >= item.available} onClick={() => updateQuantity(item.nftId, item.quantity + 1)} className="rounded-full border border-slate-200 p-2 disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold">{formatEth(sumCart([item]))} ETH</div>
              <button onClick={() => updateQuantity(item.nftId, 0)} className="mt-2 text-sm text-red-500">Remove</button>
            </div>
          </div>
        ))}
      </div>

      <aside className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="text-2xl font-semibold">Summary</h2>
        <div className="mt-6 space-y-3 text-sm text-slate-600">
          {quoteQuery.isLoading ? (
            <div className="h-24 animate-pulse rounded-2xl bg-slate-100" aria-label="Loading quote" />
          ) : quoteQuery.isError ? (
            <p role="alert" className="text-red-600">{getApiError(quoteQuery.error, 'Could not calculate the cart total.')}</p>
          ) : (
            <>
              <div className="flex justify-between"><span>Subtotal</span><span>{quoteQuery.data.subtotal} ETH</span></div>
              <div className="flex justify-between"><span>Discount</span><span>{quoteQuery.data.discount} ETH</span></div>
              <div className="flex justify-between"><span>Network fee</span><span>{quoteQuery.data.networkFee} ETH</span></div>
              <div className="mt-4 flex justify-between text-lg font-semibold text-slate-900"><span>Total</span><span>{quoteQuery.data.total} ETH</span></div>
            </>
          )}
        </div>
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Use coupon <span className="font-semibold text-slate-800">SAVE10</span> at checkout.
        </div>
        {hasAvailabilityIssue && <p role="alert" className="mt-4 text-sm text-red-600">Update quantities to match current availability before checkout.</p>}
        <Link
          to="/checkout"
          aria-disabled={hasAvailabilityIssue || quoteQuery.isError || quoteQuery.isLoading}
          className={cn(
            'mt-6 block rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white',
            (hasAvailabilityIssue || quoteQuery.isError || quoteQuery.isLoading) && 'pointer-events-none opacity-50',
          )}
        >Proceed to checkout</Link>
      </aside>
    </div>
  );
}

function CheckoutPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [walletId, setWalletId] = useState('');
  const [coupon, setCoupon] = useState('');
  const [paymentOutcome, setPaymentOutcome] = useState<'approved' | 'rejected' | 'disconnected'>('approved');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const cartQuery = useQuery({ queryKey: ['cart'], queryFn: async () => (await api.get('/cart')).data.items ?? [] });
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: async () => (await api.get('/profile')).data.user });
  const walletQuery = useQuery({ queryKey: ['wallets'], queryFn: async () => (await api.get('/wallets')).data.wallets ?? [] });
  useEffect(() => {
    if (!walletId && walletQuery.data?.length) {
      setWalletId(walletQuery.data[0].id);
    }
  }, [walletId, walletQuery.data]);
  const quoteQuery = useQuery({
    queryKey: ['quote', 'checkout', coupon, cartQuery.data],
    queryFn: async () => {
      const { data } = await api.post('/quote', { coupon });
      return data;
    },
    enabled: !!(cartQuery.data && cartQuery.data.length > 0),
  });

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError('');
    const items = cartQuery.data ?? [];
    try {
      const { data: currentQuote } = await api.post('/quote', { coupon });
      if (JSON.stringify(currentQuote) !== JSON.stringify(quoteQuery.data)) {
        setError('Price, availability, or fees changed. Review the updated total before confirming again.');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['cart'] }),
          queryClient.invalidateQueries({ queryKey: ['quote'] }),
        ]);
        return;
      }

      const fingerprint = JSON.stringify({ items, coupon, walletId, paymentOutcome });
      const savedAttempt = JSON.parse(sessionStorage.getItem('nft-marketplace-order-attempt') ?? 'null') as { fingerprint: string; key: string } | null;
      const idempotencyKey = savedAttempt?.fingerprint === fingerprint
        ? savedAttempt.key
        : `order-${crypto.randomUUID()}`;
      sessionStorage.setItem('nft-marketplace-order-attempt', JSON.stringify({ fingerprint, key: idempotencyKey }));

      const { data } = await api.post('/orders', {
        items,
        idempotencyKey,
        coupon,
        walletId,
        paymentOutcome,
      });
      if (data.status === 'confirmed') {
        sessionStorage.removeItem('nft-marketplace-order-attempt');
        await queryClient.invalidateQueries({ queryKey: ['cart'] });
        navigate({ to: `/confirmation/${data.id}` });
      } else if (data.status === 'pending') {
        navigate({ to: `/confirmation/${data.id}` });
      } else {
        setError('Payment was rejected. Your cart has been preserved.');
      }
    } catch (e: unknown) {
      setError(getApiError(e, 'Checkout failed. Retry to recover the same order attempt.'));
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['cart'] }),
          queryClient.invalidateQueries({ queryKey: ['quote'] }),
        ]);
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const items = cartQuery.data ?? [];
  if (cartQuery.isLoading) {
    return <div className="h-96 animate-pulse rounded-[32px] bg-white shadow-soft" aria-label="Loading checkout" />;
  }
  if (items.length === 0) {
    return <div className="rounded-[32px] bg-white p-8 text-center shadow-soft">Your cart is empty. <Link to="/cart" className="font-semibold text-indigo-700">Return to cart</Link></div>;
  }
  const availableWallets = walletQuery.data ?? [];
  const quote = quoteQuery.data;

  return (
    <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="space-y-6 rounded-[32px] border border-slate-200 bg-white p-6 shadow-soft">
        <h1 className="text-3xl font-semibold">Checkout</h1>
        <div className="space-y-2">
          <label htmlFor="buyer-name" className="text-sm font-medium text-slate-700">Buyer details</label>
          <input id="buyer-name" readOnly value={profileQuery.data?.name ?? ''} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
        </div>
        <div className="space-y-2">
          <label htmlFor="checkout-wallet" className="text-sm font-medium text-slate-700">Wallet</label>
          <select id="checkout-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <option value="">Select wallet</option>
            {availableWallets.map((wallet: Wallet) => (
              <option key={wallet.id} value={wallet.id}>{wallet.network} • {wallet.address}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="checkout-coupon" className="text-sm font-medium text-slate-700">Coupon</label>
          <input id="checkout-coupon" value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="SAVE10" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          {coupon && coupon !== 'SAVE10' && <div role="alert" className="text-xs text-red-500">Invalid coupon.</div>}
        </div>
        <div className="space-y-2">
          <label htmlFor="payment-outcome" className="text-sm font-medium text-slate-700">Simulated wallet result</label>
          <select id="payment-outcome" value={paymentOutcome} onChange={(e) => setPaymentOutcome(e.target.value as typeof paymentOutcome)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <option value="approved">Approve transaction</option>
            <option value="rejected">Reject transaction</option>
            <option value="disconnected">Disconnect while pending</option>
          </select>
        </div>
        {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      </div>

      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="text-2xl font-semibold">Review order</h2>
        <div className="mt-6 space-y-4">
          {items.map((item: CartItem) => (
            <div key={item.nftId} className="flex items-center justify-between rounded-2xl border border-slate-200 p-3">
              <div>
                <div className="font-medium">{item.name}</div>
                <div className="text-sm text-slate-500">Qty {item.quantity}</div>
              </div>
              <div className="font-medium">{formatEth(sumCart([item]))} ETH</div>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-3 text-sm text-slate-600">
          {quoteQuery.isLoading ? (
            <div className="h-24 animate-pulse rounded-2xl bg-slate-100" aria-label="Loading quote" />
          ) : quoteQuery.isError ? (
            <p role="alert" className="text-red-600">{getApiError(quoteQuery.error, 'Could not calculate the order total.')}</p>
          ) : quote ? (
            <>
              <div className="flex justify-between"><span>Subtotal</span><span>{quote.subtotal} ETH</span></div>
              <div className="flex justify-between"><span>Network fee</span><span>{quote.networkFee} ETH</span></div>
              <div className="flex justify-between"><span>Discount</span><span>-{quote.discount} ETH</span></div>
              <div className="mt-4 flex justify-between text-lg font-semibold text-slate-900"><span>Total</span><span>{quote.total} ETH</span></div>
            </>
          ) : null}
        </div>

        <button disabled={isSubmitting || !walletId || quoteQuery.isError || quoteQuery.isLoading} onClick={handleSubmit} className="mt-6 w-full rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {isSubmitting ? 'Processing…' : 'Confirm purchase'}
        </button>
      </div>
    </div>
  );
}

function ConfirmationPage() {
  const queryClient = useQueryClient();
  const { orderId } = useParams({ from: '/confirmation/$orderId' });
  const orderQuery = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => (await api.get(`/orders/${orderId}`)).data,
    refetchInterval: (query) => query.state.data?.status === 'pending' ? 2000 : false,
  });
  useEffect(() => {
    if (orderQuery.data?.status === 'confirmed') {
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
    }
  }, [orderQuery.data?.status, queryClient]);

  if (orderQuery.isLoading) return <div>Loading confirmation…</div>;
  if (orderQuery.isError || !orderQuery.data) {
    return <div role="alert" className="rounded-[32px] bg-white p-8 text-red-600">Could not load this order. {getApiError(orderQuery.error, 'Order not found.')}</div>;
  }

  const order = orderQuery.data;
  const confirmed = order.status === 'confirmed';

  return (
    <div className="mx-auto max-w-3xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-soft">
      <div className={cn('mb-6 flex items-center gap-3', confirmed ? 'text-emerald-600' : order.status === 'pending' ? 'text-amber-600' : 'text-red-600')}>
        {confirmed && <CheckCircle2 className="h-8 w-8" />}
        <h1 className="text-3xl font-semibold">
          {confirmed ? 'Order confirmed' : order.status === 'pending' ? 'Payment pending' : 'Payment not completed'}
        </h1>
      </div>
      {order.status === 'pending' && <p role="status" className="mb-6 text-sm text-slate-600">We are checking the wallet result. This page will update automatically without submitting another order.</p>}
      {order.status === 'failed' && <p role="alert" className="mb-6 text-sm text-red-700">The wallet rejected this payment. The items remain in your cart.</p>}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2 text-sm text-slate-600">
          <div><span className="font-medium text-slate-900">Transaction:</span> {order.transactionId}</div>
          <div><span className="font-medium text-slate-900">Status:</span> {order.status}</div>
          <div><span className="font-medium text-slate-900">Order ID:</span> {order.id}</div>
          <div><span className="font-medium text-slate-900">Date:</span> {new Date(order.createdAt).toLocaleString()}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <div className="flex justify-between"><span>Items</span><span>{order.items.length}</span></div>
          <div className="flex justify-between"><span>Fees</span><span>{order.fee} ETH</span></div>
          <div className="flex justify-between"><span>Total</span><span>{order.total} ETH</span></div>
        </div>
      </div>
    </div>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('demo@marketplace.io');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState('');

  const submit = async () => {
    try {
      const { data } = await api.post('/auth/login', { email, password });
      await establishSession(queryClient, data.user);
      const returnTo = sessionStorage.getItem('nft-marketplace-return-to');
      sessionStorage.removeItem('nft-marketplace-return-to');
      if (returnTo) {
        router.history.push(returnTo);
      } else {
        navigate({ to: '/' });
      }
    } catch (error) {
      setError(getApiError(error, 'Login failed.'));
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-[32px] border border-slate-200 bg-white p-8 shadow-soft">
      <h1 className="text-3xl font-semibold">Login</h1>
      <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">Email</label>
        <input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
        <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">Password</label>
        <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
        {error && <div role="alert" className="text-sm text-red-500">{error}</div>}
        <button type="submit" className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Sign in</button>
        <div className="text-center text-sm text-slate-500">Need an account? <Link to="/register" className="text-slate-900">Create it</Link></div>
      </form>
    </div>
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    try {
      const { data } = await api.post('/auth/register', { name, email, password });
      await establishSession(queryClient, data.user);
      navigate({ to: '/' });
    } catch (error) {
      setError(getApiError(error, 'Registration failed.'));
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-[32px] border border-slate-200 bg-white p-8 shadow-soft">
      <h1 className="text-3xl font-semibold">Create account</h1>
      <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label htmlFor="register-name" className="block text-sm font-medium text-slate-700">Name</label>
        <input id="register-name" autoComplete="name" minLength={2} required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
        <label htmlFor="register-email" className="block text-sm font-medium text-slate-700">Email</label>
        <input id="register-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
        <label htmlFor="register-password" className="block text-sm font-medium text-slate-700">Password (at least 8 characters)</label>
        <input id="register-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
        {error && <div role="alert" className="text-sm text-red-500">{error}</div>}
        <button type="submit" className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Register</button>
      </form>
    </div>
  );
}

function ProfilePage() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: async () => (await api.get('/profile')).data.user });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [avatar, setAvatar] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (profileQuery.data) {
      setName(profileQuery.data.name);
      setEmail(profileQuery.data.email);
      setAvatar(profileQuery.data.avatar);
    }
  }, [profileQuery.data]);

  const selectAvatar = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
      setError('Choose an image smaller than 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setAvatar(reader.result);
    };
    reader.onerror = () => setError('Could not read the selected image.');
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    setError('');
    setSuccess('');
    try {
      await api.put('/profile', { name, email, avatar });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
      ]);
      setSuccess('Profile saved.');
    } catch (error) {
      setError(getApiError(error, 'Failed to save profile.'));
    }
  };

  const changePassword = async () => {
    setError('');
    setSuccess('');
    try {
      await api.put('/profile/password', { currentPassword, newPassword: password });
      setSuccess('Password updated.');
      setCurrentPassword('');
      setPassword('');
    } catch (error) {
      setError(getApiError(error, 'Password update failed.'));
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="text-2xl font-semibold">Profile</h2>
        <div className="mt-6 space-y-4">
          <img src={avatar} alt={`Avatar for ${name || 'collector'}`} className="h-20 w-20 rounded-full object-cover" />
          <label htmlFor="profile-avatar" className="block text-sm font-medium text-slate-700">Avatar image</label>
          <input id="profile-avatar" type="file" accept="image/*" onChange={(event) => selectAvatar(event.target.files?.[0])} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          <label htmlFor="profile-name" className="block text-sm font-medium text-slate-700">Name</label>
          <input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          <label htmlFor="profile-email" className="block text-sm font-medium text-slate-700">Email</label>
          <input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          {error && <div role="alert" className="text-sm text-red-500">{error}</div>}
          {success && <div role="status" className="text-sm text-emerald-600">{success}</div>}
          <button onClick={saveProfile} className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Save profile</button>
        </div>
      </div>

      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="text-2xl font-semibold">Password</h2>
        <div className="mt-6 space-y-4">
          <label htmlFor="current-password" className="block text-sm font-medium text-slate-700">Current password</label>
          <input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" autoComplete="current-password" />
          <label htmlFor="new-password" className="block text-sm font-medium text-slate-700">New password</label>
          <input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" autoComplete="new-password" minLength={8} />
          <button onClick={changePassword} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900">Update password</button>
        </div>
      </div>
    </div>
  );
}

function WalletsPage() {
  const queryClient = useQueryClient();
  const walletQuery = useQuery({ queryKey: ['wallets'], queryFn: async () => (await api.get('/wallets')).data.wallets ?? [] });
  const [label, setLabel] = useState('');
  const [network, setNetwork] = useState('Ethereum');
  const [address, setAddress] = useState('');
  const [editId, setEditId] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const addWallet = async () => {
    setError('');
    setSuccess('');
    try {
      if (editId) {
        await api.put(`/wallets/${editId}`, { label, network, address, isPrimary });
      } else {
        await api.post('/wallets', { label, network, address, isPrimary });
      }
      await queryClient.invalidateQueries({ queryKey: ['wallets'] });
      setLabel('');
      setNetwork('Ethereum');
      setAddress('');
      setEditId('');
      setIsPrimary(false);
      setSuccess(editId ? 'Wallet updated.' : 'Wallet added.');
    } catch (error) {
      setError(getApiError(error, 'Could not save this wallet.'));
    }
  };

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-soft">
      <h1 className="text-3xl font-semibold">Wallets</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
        <h2 className="text-xl font-semibold">{editId ? 'Edit wallet' : 'Add a wallet'}</h2>
        <label htmlFor="wallet-label" className="block text-sm font-medium text-slate-700">Wallet label</label>
        <input id="wallet-label" value={label} onChange={(e) => setLabel(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="Wallet label" />
        <label htmlFor="wallet-network" className="block text-sm font-medium text-slate-700">Network</label>
        <select id="wallet-network" value={network} onChange={(e) => setNetwork(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <option>Ethereum</option><option>Polygon</option><option>Base</option>
        </select>
        <label htmlFor="wallet-address" className="block text-sm font-medium text-slate-700">Wallet address</label>
        <input id="wallet-address" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" placeholder="0x…" />
        {editId && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Set as primary wallet</label>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
        <button onClick={addWallet} className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">{editId ? 'Save wallet' : 'Add wallet'}</button>
        {editId && <button onClick={() => { setEditId(''); setLabel(''); setAddress(''); setIsPrimary(false); }} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold">Cancel edit</button>}
      </div>
      <div className="space-y-3">
        {(walletQuery.data ?? []).map((wallet: Wallet) => (
            <div key={wallet.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{wallet.label}</div>
                  <div className="text-sm text-slate-500">{wallet.network}</div>
                </div>
                {wallet.isPrimary && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">Primary</span>}
              </div>
              <div className="mt-3 text-sm text-slate-600">{wallet.address}</div>
              <button
                onClick={() => {
                  setEditId(wallet.id);
                  setLabel(wallet.label);
                  setNetwork(wallet.network);
                  setAddress(wallet.address);
                  setIsPrimary(wallet.isPrimary);
                }}
                className="mt-4 rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium hover:border-slate-400"
              >Edit wallet</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <RouterProvider router={router} />;
}
