import { StoreHeader } from '@/components/StoreHeader';
import { Skeleton } from '@/components/Skeleton';

interface StoreSkeletonProps {
  variant?: 'home' | 'store' | 'product' | 'list';
}

export function StoreSkeleton({ variant = 'home' }: StoreSkeletonProps) {
  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
        {variant === 'home' && (
          <>
            <div className="rounded-3xl border border-line bg-card p-6 sm:p-10">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="mt-4 h-8 w-3/4 max-w-lg" />
              <Skeleton className="mt-2 h-8 w-1/2 max-w-sm" />
              <Skeleton className="mt-4 h-4 w-full max-w-md" />
              <div className="mt-7 flex gap-3">
                <Skeleton className="h-12 w-36" />
                <Skeleton className="h-12 w-32" />
              </div>
            </div>
            <div className="mt-8 flex items-center justify-between">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-2xl border border-line bg-card">
                  <Skeleton className="aspect-square rounded-none" />
                  <div className="space-y-2 p-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {variant === 'store' && (
          <>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="mt-2 h-4 w-64" />
            <Skeleton className="mt-5 h-11 w-full" />
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-line bg-card p-4">
                  <Skeleton className="h-10 w-10" />
                  <Skeleton className="mt-3 h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-full" />
                </div>
              ))}
            </div>
          </>
        )}

        {variant === 'product' && (
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
            <Skeleton className="aspect-square rounded-3xl" />
            <div className="space-y-4">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-8 w-40" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-20 w-full rounded-2xl" />
              <Skeleton className="h-14 w-full rounded-2xl" />
            </div>
          </div>
        )}

        {variant === 'list' && (
          <>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="mt-2 h-4 w-48" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-line bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                    <Skeleton className="h-5 w-20" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
