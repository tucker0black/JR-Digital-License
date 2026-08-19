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
        <h2 className="text-lg font-bold tracking-tight text-ink sm:text-xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
