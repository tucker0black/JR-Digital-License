'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[] = []): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const [reloadKey, setReloadKey] = useState(0);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef.current()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            error: error instanceof Error ? error.message : 'Request failed',
            loading: false
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, ...deps]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { ...state, reload };
}