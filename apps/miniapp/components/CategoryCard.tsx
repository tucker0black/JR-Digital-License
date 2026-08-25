import { memo } from 'react';
import type { Category } from '@/lib/api';
import { CategoryIcon } from '@/components/CategoryIcon';

interface CategoryCardProps {
  category: Category;
}

export const CategoryCard = memo(function CategoryCard({ category }: CategoryCardProps) {
  return (
    <article className="group flex h-full flex-col rounded-2xl card-cosmic p-4 transition-luxury hover:-translate-y-1 hover:shadow-glow-sm active:scale-[0.97]">
      <div className="flex items-start justify-between gap-2">
        <CategoryIcon imageUrl={category.imageUrl} icon={category.icon} name={category.name} />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 text-line transition-luxury group-hover:translate-x-0.5 group-hover:text-primary"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </div>
      <h3 className="mt-3 text-sm font-semibold text-ink">{category.name}</h3>
      {category.description && (
        <p className="mt-1 line-clamp-2 text-xs text-soft">{category.description}</p>
      )}
    </article>
  );
});
