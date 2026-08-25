'use client';

import { useEffect, useState } from 'react';

const TOAST_EVENT = 'jr:toast';

export function showToast(message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(TOAST_EVENT, { detail: message }));
}

interface ToastItem {
  id: number;
  message: string;
}

/** Minimal transient message host (used for non-blocking UI feedback). */
export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    let counter = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      if (!message) return;
      const id = ++counter;
      setToasts((prev) => [...prev.slice(-2), { id, message }]);
      timers.add(setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 2600));
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-8"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-fade-up max-w-sm rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-center text-sm font-medium text-danger shadow-lg backdrop-blur-sm"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
