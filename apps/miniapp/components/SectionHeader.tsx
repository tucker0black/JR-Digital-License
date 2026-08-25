import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold tracking-premium text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted-text">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
