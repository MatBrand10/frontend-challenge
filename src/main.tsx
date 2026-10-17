import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 20000 } },
});

async function enableMocking() {
  const mocksEnabled = import.meta.env.VITE_ENABLE_MOCKS !== 'false';

  if (mocksEnabled) {
    const { worker } = await import('./mocks/browser');
    await worker.start({
      onUnhandledRequest: 'bypass',
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    });
  }
}

enableMocking()
  .then(async () => {
    const { default: App } = await import('./App');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error('Failed to initialize the application.', error);
    const root = document.getElementById('root');
    if (root) {
      root.textContent = 'The application could not start. Please refresh and try again.';
    }
  });
