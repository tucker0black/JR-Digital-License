import type { ReactNode } from 'react';

export type BadgeTone = 'primary' | 'amber' | 'green' | 'red' | 'violet' | 'slate' | 'accent';

const toneClasses: Record<BadgeTone, string> = {
  primary: 'bg-primary/10 text-primary border border-primary/15',
  accent: 'bg-accent/10 text-accent border border-accent/15',
  amber: 'bg-warning/10 text-warning border border-warning/15',
  green: 'bg-success/10 text-success border border-success/15',
  red: 'bg-danger/10 text-danger border border-danger/15',
  violet: 'bg-violet/10 text-violet border border-violet/15',
  slate: 'bg-muted/60 text-muted-text border border-line/30',
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

export function Badge({ children, tone = 'slate', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
