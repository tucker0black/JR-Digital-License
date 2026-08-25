import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { formatDateTime } from '@/lib/format';

export function formatDate(iso: string | null | undefined): string {
  return formatDateTime(iso);
}

export function formatMoney(amount: string | number | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined) return '\u2014';
  return `${currency} ${Number(amount).toFixed(2)}`;
}

type BadgeTone = 'default' | 'success' | 'danger' | 'warning' | 'accent' | 'muted';

const badgeTones: Record<BadgeTone, string> = {
  default: 'bg-muted text-soft border border-line/50',
  success: 'bg-success/10 text-success border border-success/20',
  danger: 'bg-danger/10 text-danger border border-danger/20',
  warning: 'bg-warning/10 text-warning border border-warning/20',
  accent: 'bg-accent/10 text-accent border border-accent/20',
  muted: 'bg-muted/60 text-muted-text border border-line/30',
};

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

const statusToneMap: Record<string, BadgeTone> = {
  ACTIVE: 'success', COMPLETED: 'success', SUCCEEDED: 'success',
  DELIVERED: 'success', AVAILABLE: 'success', OPEN: 'success', PAID: 'success',
  PROCESSING: 'accent', FULFILLING: 'accent', IN_PROGRESS: 'accent', RESERVED: 'accent',
  PENDING: 'warning', PAYMENT_PENDING: 'warning',
  DRAFT: 'muted', DISABLED: 'muted', ARCHIVED: 'muted',
  OUT_OF_STOCK: 'warning',
  CANCELLED: 'danger', EXPIRED: 'danger', FAILED: 'danger',
  DELIVERY_FAILED: 'danger', REFUNDED: 'danger', REVERSED: 'danger', SUSPENDED: 'danger',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = statusToneMap[status] ?? 'default';
  return <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>;
}

export function Card({ title, description, action, children, className = '' }: {
  title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line/40 bg-card p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-premium text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-text">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint, icon }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode;
}) {
  return (
    <Card className="py-4 transition-luxury hover:border-primary/20 hover:shadow-glow-subtle">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide-premium text-muted-text">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-premium text-ink tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-text">{hint}</p>}
        </div>
        {icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle' | 'accent';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-r from-primary to-violet text-white shadow-blue-sm hover:shadow-blue hover:active:scale-[0.97]',
  ghost: 'border border-line/50 text-soft hover:border-primary/30 hover:text-primary hover:bg-primary-soft/30',
  danger: 'bg-danger/90 text-white hover:bg-danger active:scale-[0.97]',
  subtle: 'bg-muted/60 text-soft hover:bg-muted hover:text-ink',
  accent: 'bg-gradient-to-r from-accent to-primary text-white shadow-md shadow-accent/15 hover:shadow-lg hover:shadow-accent/25 active:scale-[0.97]',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-luxury disabled:opacity-50 disabled:cursor-not-allowed ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
}

const inputClasses =
  'w-full rounded-xl border border-line/50 bg-card px-4 py-2.5 text-sm text-ink placeholder:text-muted-text/60 transition-luxury focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:outline-none';

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
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide-premium text-muted-text">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px] text-muted-text">{hint}</span>}
    </label>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-premium text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-text">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading\u2026' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-line/30 bg-card py-12 text-sm text-muted-text">
      <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-primary" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-danger/20 bg-danger/5 px-5 py-8 text-center">
      <p className="text-sm font-medium text-danger">{error}</p>
      {onRetry && (
        <Button variant="ghost" className="mt-3" onClick={onRetry}>Retry</Button>
      )}
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <div className="rounded-2xl border border-line/30 bg-card px-5 py-12 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 text-muted-text">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {message && <p className="mt-1 text-xs text-muted-text">{message}</p>}
    </div>
  );
}

export function Pagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-text">
      <span className="tabular-nums">{total} total \u00b7 page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
        <Button variant="ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line/30">
      <table className="w-full min-w-150 text-left text-sm">
        <thead>
          <tr className="border-b border-line/30 bg-surface/50">
            {headers.map((header) => (
              <th key={header} className="px-4 py-3 text-[11px] font-medium uppercase tracking-wide-premium text-muted-text">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/20">{children}</tbody>
      </table>
    </div>
  );
}
