export type Nft = {
  id: string;
  name: string;
  collection: string;
  artist: string;
  description: string;
  image: string;
  price: string;
  available: number;
  likes: number;
  edition: string;
  tags: string[];
};

export type Wallet = {
  id: string;
  label: string;
  network: string;
  address: string;
  isPrimary: boolean;
};

export type User = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  wallets: Wallet[];
};

export type CartItem = {
  nftId: string;
  quantity: number;
  name: string;
  image: string;
  price: string;
  available: number;
  edition: string;
};

export type OrderStatus = 'pending' | 'confirmed' | 'failed';

export type Order = {
  id: string;
  status: OrderStatus;
  total: string;
  subtotal: string;
  discount: string;
  fee: string;
  items: CartItem[];
  transactionId: string;
  createdAt: string;
  isIdempotent: boolean;
  requestFingerprint?: string;
};

export type Quote = {
  subtotal: string;
  discount: string;
  networkFee: string;
  total: string;
  coupon?: string;
};
