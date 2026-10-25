"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * One `QueryClient` per browser session, created the same way the engine is
 * (lazy initializer, never recreated).
 *
 * Creating it at module scope would share one cache across every request on
 * the server — fine in this app, which only queries from the client, but a
 * data leak the moment someone prefetches on the server. `useState` keeps it
 * per-component-instance, which on the client means per tab.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Search results for the same term don't change minute to minute;
            // backspacing should hit the cache, not the service.
            staleTime: 5 * 60_000,
            gcTime: 10 * 60_000,
            // A geocoder that 403s because the key is missing will 403 again.
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
