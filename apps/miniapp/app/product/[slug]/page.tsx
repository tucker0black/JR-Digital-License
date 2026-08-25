import { getProduct } from '@/lib/api';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BuyButton } from '@/components/BuyButton';
import { StoreHeader } from '@/components/StoreHeader';
import { Badge } from '@/components/Badge';
import { ProductDetailClient } from '@/components/ProductDetailClient';
import { TranslatedText } from '@/components/TranslatedText';

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
      <main className="min-h-screen bg-page bg-cosmic text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 sm:px-6 md:pb-16">
          <Link
            href={product.category ? `/store/${product.category.slug}` : '/store'}
            className="inline-flex items-center gap-1.5 text-sm text-soft transition-default hover:text-primary"
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
            <TranslatedText k="product.back" />
          </Link>

          <article className="mt-5 grid gap-6 lg:grid-cols-2 lg:gap-10">
            <ProductDetailClient product={product}>
              <div className="relative aspect-square overflow-hidden rounded-3xl bg-muted">
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
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 to-violet/20">
                    <span className="text-6xl font-bold text-primary/30">
                      {product.name.charAt(0)}
                    </span>
                  </div>
                )}
                <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                  {product.isFeatured && (
                    <Badge tone="primary"><TranslatedText k="product.featured" /></Badge>
                  )}
                  {product.isPopular && (
                    <Badge tone="amber"><TranslatedText k="product.popular" /></Badge>
                  )}
                </div>
                {isOutOfStock && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <Badge tone="red"><TranslatedText k="product.outOfStock" /></Badge>
                  </div>
                )}
              </div>
            </ProductDetailClient>

            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                  {product.deliveryType.toLowerCase().replace('_', ' ')}
                </p>
                <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
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
                <span className="rounded-lg bg-primary/10 px-3 py-1 text-xs font-medium capitalize text-primary">
                  {product.type.toLowerCase().replace('_', ' ')}
                </span>
                {product.isHandDelivery && (
                  <span className="rounded-lg bg-violet/10 px-3 py-1 text-xs font-medium text-violet">
                    <TranslatedText k="product.handDelivery" />
                  </span>
                )}
                {product.minimumQuantity > 1 && (
                  <span className="rounded-lg bg-muted px-3 py-1 text-xs font-medium text-soft">
                    <TranslatedText k="product.min" params={{ value: product.minimumQuantity }} />
                  </span>
                )}
                {product.maximumQuantity !== null && product.maximumQuantity > 1 && product.maximumQuantity < 9999 && (
                  <span className="rounded-lg bg-muted px-3 py-1 text-xs font-medium text-soft">
                    <TranslatedText k="product.max" params={{ value: product.maximumQuantity }} />
                  </span>
                )}
              </div>

              <section className="rounded-2xl card-cosmic p-5">
                <h2 className="font-semibold text-ink"><TranslatedText k="product.availability" /></h2>
                <div className="mt-2.5 flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        product.isHandDelivery ? 'bg-violet' : isOutOfStock ? 'bg-danger' : 'bg-success'
                      }`}
                    />
                    <span className="text-sm text-soft">
                      {product.isHandDelivery ? (
                        <TranslatedText k="product.handDeliveryNote" />
                      ) : isOutOfStock ? (
                        <TranslatedText k="product.outOfStock" />
                      ) : (
                        <TranslatedText k="product.inStock" />
                      )}
                    </span>
                  </div>
                  {!product.isHandDelivery && !isOutOfStock && product.availableStock !== undefined && product.availableStock > 0 && (
                    <span className="text-sm text-soft">
                      {product.availableStock} <TranslatedText k="product.available" />
                    </span>
                  )}
                </div>
              </section>

              {product.description && (
                <section className="rounded-2xl card-cosmic p-5">
                  <h2 className="font-semibold text-ink"><TranslatedText k="product.description" /></h2>
                  <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-soft">
                    {product.description}
                  </p>
                </section>
              )}

              {product.instructions && (
                <section className="rounded-2xl card-cosmic p-5">
                  <h2 className="font-semibold text-ink"><TranslatedText k="product.instructions" /></h2>
                  <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-soft">
                    {product.instructions}
                  </p>
                </section>
              )}

              <section className="rounded-2xl card-cosmic p-5">
                <h2 className="font-semibold text-ink"><TranslatedText k="product.whyChooseUs" /></h2>
                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 text-green-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink"><TranslatedText k="product.securePayment" /></p>
                      <p className="text-xs text-soft"><TranslatedText k="product.securePaymentDescription" /></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 text-blue-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink"><TranslatedText k="product.instantDelivery" /></p>
                      <p className="text-xs text-soft"><TranslatedText k="product.instantDeliveryDescription" /></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 text-purple-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink"><TranslatedText k="product.support247" /></p>
                      <p className="text-xs text-soft"><TranslatedText k="product.support247Description" /></p>
                    </div>
                  </div>
                </div>
              </section>

              <BuyButton
                productId={product.id}
                price={product.price}
                currency={product.currency}
                minimumQuantity={product.minimumQuantity}
                maximumQuantity={product.maximumQuantity}
                isOutOfStock={isOutOfStock}
                availableStock={product.availableStock}
                isSmm={product.type === 'SMM_API'}
                services={product.services ?? []}
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
