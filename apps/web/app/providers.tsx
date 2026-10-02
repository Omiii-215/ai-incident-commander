'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Stale time is a usability setting, not permission validity.
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
          },
          mutations: { retry: false }, // never blindly repeat a command
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
