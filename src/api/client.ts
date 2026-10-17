import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 8000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('nft-marketplace-token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(undefined, (error: unknown) => {
  if (
    axios.isAxiosError(error)
    && error.response?.status === 401
    && error.config?.headers?.Authorization
    && !['/auth/login', '/auth/register'].includes(error.config.url ?? '')
  ) {
    localStorage.removeItem('nft-marketplace-token');
    localStorage.removeItem('nft-marketplace-session');
    window.dispatchEvent(new Event('marketplace:session-expired'));
  }
  return Promise.reject(error);
});
