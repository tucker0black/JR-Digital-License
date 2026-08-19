'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useEffect, useCallback, type FormEvent } from 'react';

interface SearchBarProps {
  category?: string;
}

export function SearchBar({ category }: SearchBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('search') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  const isStorePage = pathname === '/store' || pathname.startsWith('/store/');

  const buildSearchUrl = useCallback(
    (q: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (q) {
        params.set('search', q);
      } else {
        params.delete('search');
      }
      const basePath = category ? `/store/${category}` : '/store';
      return `${basePath}?${params.toString()}`;
    },
    [searchParams, category]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!isStorePage) return;
    if (!debouncedQuery && !searchParams.has('search')) return;
    const next = buildSearchUrl(debouncedQuery);
    const basePath = category ? `/store/${category}` : '/store';
    const current = `${basePath}?${searchParams.toString()}`;
    if (next === current) return;
    router.push(next, { scroll: false });
  }, [debouncedQuery, router, searchParams, category, isStorePage, buildSearchUrl]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isStorePage) {
      router.push(buildSearchUrl(query), { scroll: false });
    }
  };

  return (
    <form className="relative" onSubmit={handleSubmit}>
      <label htmlFor="search" className="sr-only">Search products</label>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        id="search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products or services..."
        className="w-full rounded-2xl border border-line bg-card py-3 pl-10 pr-10 text-sm text-ink shadow-sm transition placeholder:text-soft/70 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
        autoComplete="off"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery('')}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-soft transition hover:bg-line hover:text-ink"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="h-3.5 w-3.5"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </form>
  );
}