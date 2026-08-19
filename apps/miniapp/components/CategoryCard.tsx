import { memo } from 'react';
import type { Category } from '@/lib/api';

interface CategoryCardProps {
  category: Category;
}

export const CategoryCard = memo(function CategoryCard({ category }: CategoryCardProps) {
  return (
    <article className="group flex h-full flex-col rounded-2xl border border-line bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md active:scale-[0.98]">
      <div className="flex items-start justify-between gap-2">
        {category.icon ? (
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-lg">
            {category.icon}
          </span>
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-sm font-bold text-soft">
            {category.name.charAt(0)}
          </span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 text-line transition group-hover:text-primary"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </div>
      <h3 className="mt-3 font-semibold text-ink">{category.name}</h3>
      {category.description && (
        <p className="mt-1 line-clamp-2 text-xs text-soft">{category.description}</p>
      )}
    </article>
  );
});
