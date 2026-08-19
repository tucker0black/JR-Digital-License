import Link from 'next/link';
import { memo } from 'react';
import type { Product } from '@/lib/api';
import { Badge } from '@/components/Badge';

interface ProductCardProps {
  product: Product;
}

export const ProductCard = memo(function ProductCard({ product }: ProductCardProps) {
  const isOutOfStock = product.isOutOfStock === true;
  const deliveryLabel = product.deliveryType.toLowerCase().replace('_', ' ');

  return (
    <Link
      href={`/product/${product.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 active:scale-[0.98]"
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            decoding="async"
            width={600}
            height={600}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-soft to-muted">
            <span className="text-3xl font-bold text-primary/50">
              {product.name.charAt(0)}
            </span>
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {product.isFeatured && <Badge tone="primary">Featured</Badge>}
          {product.isPopular && <Badge tone="amber">Popular</Badge>}
        </div>
        {isOutOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/70 backdrop-blur-[2px]">
            <Badge tone="red">Out of Stock</Badge>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink">
          {product.name}
        </h3>
        {product.description && (
          <p className="line-clamp-1 text-xs text-soft">{product.description}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="text-sm font-bold text-ink">
            {product.currency === 'USD' ? '$' : ''}{Number(product.price).toFixed(2)}{' '}
            <span className="text-xs font-medium text-soft">{product.currency}</span>
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold capitalize text-soft">
            {deliveryLabel}
          </span>
        </div>
      </div>
    </Link>
  );
});
