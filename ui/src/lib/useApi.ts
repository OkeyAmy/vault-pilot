import { useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Fetch once on mount, then poll. `deps` should name the inputs that make the
 * request different; the fetcher itself is intentionally not a dependency so
 * an inline arrow does not restart the poll on every render.
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  pollMs = 0,
  deps: unknown[] = [],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetcher();
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            // Keep the last good data visible rather than blanking the page
            // when a single poll fails.
            data: prev.data,
            error: (err as Error).message,
            loading: false,
          }));
        }
      }
    };

    void load();
    if (pollMs <= 0) return () => { cancelled = true; };

    const timer = setInterval(() => void load(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, ...deps]);

  return state;
}
