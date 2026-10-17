import { ws } from 'msw';
import { toSocketIo } from '@mswjs/socket.io-binding';

export const mockSocketUrl = 'wss://marketplace.mock';
const mockSocket = ws.link(mockSocketUrl);
const socketServers = new Set<ReturnType<typeof toSocketIo>['server']>();

type NftUpdate = {
  nftId: string;
  price: string;
  available: number;
  version: number;
};

type OrderUpdate = {
  orderId: string;
  userId: string;
  status: 'pending' | 'confirmed' | 'failed';
  version: number;
};

export function publishNftUpdate(update: NftUpdate) {
  socketServers.forEach((server) => server.emit('nft.updated', update));
}

export function publishOrderUpdate(update: OrderUpdate) {
  socketServers.forEach((server) => server.emit('order.updated', update));
}

export const socketHandlers = [
  mockSocket.addEventListener('connection', (connection) => {
    const mockServer = Object.create(connection.server) as typeof connection.server;
    Object.defineProperty(mockServer, 'send', {
      value: (data: Parameters<typeof connection.client.send>[0]) => connection.client.send(data),
    });
    const { server } = toSocketIo({ ...connection, server: mockServer });
    socketServers.add(server);
    connection.client.addEventListener('close', () => socketServers.delete(server));
  }),
];
