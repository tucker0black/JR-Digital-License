import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { formatDateTime } from '@/lib/format';

export function formatDate(iso: string | null | undefined): string {
  return formatDateTime(iso);
}

export function formatMoney(amount: string | number | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined) return '—';
  return `${currency} ${Number(amount).toFixed(2)}`;
}

type BadgeTone = 'default' | 'success' | 'danger' | 'warning' | 'accent' | 'muted';

const badgeTones: Record<BadgeTone, string> = {
  default: 'bg-slate-700/50 text-slate-200 border-slate-600/50',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  danger: 'bg-red-500/15 text-red-300 border-red-500/40',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  accent: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  muted: 'bg-slate-800/60 text-slate-400 border-slate-700'
};

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

const statusToneMap: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  COMPLETED: 'success',
  SUCCEEDED: 'success',
  DELIVERED: 'success',
  AVAILABLE: 'success',
  OPEN: 'success',
  PAID: 'success',
  PROCESSING: 'accent',
  FULFILLING: 'accent',
  IN_PROGRESS: 'accent',
  RESERVED: 'accent',
  PENDING: 'warning',
  PAYMENT_PENDING: 'warning',
  DRAFT: 'muted',
  DISABLED: 'muted',
  ARCHIVED: 'muted',
  OUT_OF_STOCK: 'warning',
  CANCELLED: 'danger',
  EXPIRED: 'danger',
  FAILED: 'danger',
  DELIVERY_FAILED: 'danger',
  REFUNDED: 'danger',
  REVERSED: 'danger',
  SUSPENDED: 'danger'
};

export function StatusBadge({ status }: { status: string }) {
  const tone = statusToneMap[status] ?? 'default';
  return <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>;
}

export function Card({ title, description, action, children, className = '' }: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-card p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-100">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="py-3">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50',
  ghost: 'border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-50',
  danger: 'bg-red-500/90 text-white hover:bg-red-500 disabled:opacity-50',
  subtle: 'bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50'
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
}

const inputClasses =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClasses} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputClasses} min-h-20`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClasses} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-slate-800 bg-card py-10 text-sm text-slate-400">
      <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-6 text-center">
      <p className="text-sm font-medium text-red-300">{error}</p>
      {onRetry && (
        <Button variant="ghost" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-card px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {message && <p className="mt-1 text-xs text-slate-500">{message}</p>}
    </div>
  );
}

export function Pagination({ page, total, pageSize, onChange }: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-400">
      <span>
        {total} total · page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-150 text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">{children}</tbody>
      </table>
    </div>
  );
}