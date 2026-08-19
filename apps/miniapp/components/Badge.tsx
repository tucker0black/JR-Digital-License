import type { ReactNode } from 'react';

export type BadgeTone = 'primary' | 'amber' | 'green' | 'red' | 'violet' | 'slate';

const toneClasses: Record<BadgeTone, string> = {
  primary: 'bg-primary-soft text-primary',
  amber: 'bg-warning/15 text-warning',
  green: 'bg-success/15 text-success',
  red: 'bg-danger/15 text-danger',
  violet: 'bg-violet/15 text-violet',
  slate: 'bg-muted text-soft'
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

export function Badge({ children, tone = 'slate', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
