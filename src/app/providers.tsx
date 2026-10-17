/**
 * DeviceHub client providers (QueryClient must be created client-side).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 4000, retry: 1, refetchOnWindowFocus: false },
        },
      })
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
