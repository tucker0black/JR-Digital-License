import { getProduct } from '@/lib/api';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BuyButton } from '@/components/BuyButton';
import { StoreHeader } from '@/components/StoreHeader';
import { Badge } from '@/components/Badge';

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const { product } = await getProduct(slug);
    return {
      title: `${product.name} - JR Digital license`,
      description: product.description || `View ${product.name} details`
    };
  } catch {
    return { title: 'Product - JR Digital license' };
  }
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;

  try {
    const { product } = await getProduct(slug);
    const isOutOfStock = product.isOutOfStock === true;

    return (
      <main className="min-h-screen bg-page text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 sm:px-6 md:pb-16">
          <Link
            href={product.category ? `/store/${product.category.slug}` : '/store'}
            className="inline-flex items-center gap-1.5 text-sm text-soft transition hover:text-primary"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
            Back
          </Link>

          <article className="mt-4 grid gap-6 lg:grid-cols-2 lg:gap-10">
            <div className="relative aspect-square overflow-hidden rounded-3xl border border-line bg-muted shadow-sm">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                   alt={product.name}
                   width={800}
                   height={800}
                   fetchPriority="high"
                   decoding="async"
                   className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-soft to-muted">
                  <span className="text-6xl font-bold text-primary/40">
                    {product.name.charAt(0)}
                  </span>
                </div>
              )}
              <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                {product.isFeatured && <Badge tone="primary">Featured</Badge>}
                {product.isPopular && <Badge tone="amber">Popular</Badge>}
              </div>
              {isOutOfStock && (
                <div className="absolute inset-0 flex items-center justify-center bg-card/70 backdrop-blur-[2px]">
                  <Badge tone="red">Out of Stock</Badge>
                </div>
              )}
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
                  {product.deliveryType.toLowerCase().replace('_', ' ')}
                </p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  {product.name}
                </h1>
                <p className="mt-2 text-3xl font-bold text-ink">
                  {product.currency === 'USD' ? '$' : ''}
                  {Number(product.price).toFixed(2)}{' '}
                  <span className="text-base font-medium text-soft">
                    {product.currency}
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium capitalize text-soft">
                  {product.type.toLowerCase().replace('_', ' ')}
                </span>
                {product.minimumQuantity > 1 && (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-soft">
                    Min: {product.minimumQuantity}
                  </span>
                )}
                {product.maximumQuantity !== null && product.maximumQuantity > 1 && product.maximumQuantity < 9999 && (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-soft">
                    Max: {product.maximumQuantity}
                  </span>
                )}
              </div>

              <section className="rounded-2xl border border-line bg-card p-5">
                <h2 className="font-semibold text-ink">Availability</h2>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        isOutOfStock ? 'bg-danger' : 'bg-success'
                      }`}
                    />
                    <span className="text-sm text-soft">
                      {isOutOfStock ? 'Out of Stock' : 'In Stock'}
                    </span>
                  </div>
                  {!isOutOfStock && product.availableStock !== undefined && product.availableStock > 0 && (
                    <span className="text-sm text-soft">
                      {product.availableStock} available
                    </span>
                  )}
                </div>
              </section>

              {product.description && (
                <section className="rounded-2xl border border-line bg-card p-5">
                  <h2 className="font-semibold text-ink">Description</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-soft">
                    {product.description}
                  </p>
                </section>
              )}

              {product.instructions && (
                <section className="rounded-2xl border border-line bg-card p-5">
                  <h2 className="font-semibold text-ink">Instructions</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-soft">
                    {product.instructions}
                  </p>
                </section>
              )}

              <BuyButton
                productId={product.id}
                price={product.price}
                currency={product.currency}
                minimumQuantity={product.minimumQuantity}
                maximumQuantity={product.maximumQuantity}
                isOutOfStock={isOutOfStock}
                availableStock={product.availableStock}
              />
            </div>
          </article>
        </div>
      </main>
    );
  } catch {
    notFound();
  }
}
