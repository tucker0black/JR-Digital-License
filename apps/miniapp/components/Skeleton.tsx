interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`skeleton ${className}`} />;
}

/**
 * Matches the real ProductCard layout: square image area + title lines +
 * price/delivery row, so data arrival causes no layout jump.
 */
export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl card-cosmic" aria-hidden="true">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-2 p-3.5">
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-end justify-between pt-1.5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/**
 * Matches list rows with a leading icon tile (OrderCard, notifications):
 * icon chip + title/subtitle/date stack + trailing amount.
 */
export function RowSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 rounded-2xl card-cosmic p-4 ${className}`} aria-hidden="true">
      <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3 w-full max-w-[200px]" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <Skeleton className="h-4 w-12 shrink-0" />
    </div>
  );
}
