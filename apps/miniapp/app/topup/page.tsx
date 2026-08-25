'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createTopUpOrder, getBanners, getCategories, getTopUpGames, getTopUpPackages, getTopUpVerificationInfo, verifyTopUpAccount, type CustomerBanner, type TopUpGameConfig, type TopUpPackage, type TopUpGame, type TopUpVerificationInfo } from '@/lib/api';
import { StoreHeader } from '@/components/StoreHeader';
import { TelegramAuthNotice } from '@/components/TelegramAuthNotice';
import { useTelegramAuth } from '@/components/TelegramProvider';
import { BannerCarousel } from '@/components/BannerCarousel';
import { AccountVerification } from '@/components/AccountVerification';
import { findTopUpCategory } from '@/lib/banners';
import { useTranslation } from '@/lib/i18n';
import dynamic from 'next/dynamic';

const PaymentActions = dynamic(
  () => import('@/components/PaymentActions').then((module) => module.PaymentActions),
  { loading: () => <PaymentOptionsLoading /> }
);

function PaymentOptionsLoading() {
  const { t } = useTranslation();
  return <div className="rounded-2xl card-cosmic p-4 text-center text-sm text-soft">{t('cart.loadingPaymentOptions')}</div>;
}

/**
 * Game grid image. A load failure only flips LOCAL state (emoji fallback);
 * it never touches the database, and the failure is keyed to the exact URL
 * so a replaced/fixed image URL always gets a fresh attempt.
 */
function FailedSafeGameImage({ game }: { game: TopUpGame }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === game.imageUrl;
  if (failed) return <span className="text-3xl">🎮</span>;
  return (
    <img
      src={game.imageUrl ?? undefined}
      alt={game.name}
      className="w-20 h-20 object-cover rounded-xl"
      onError={() => setFailedUrl(game.imageUrl)}
    />
  );
}

/**
 * Package card image. Same strategy as FailedSafeGameImage: a load failure
 * only flips LOCAL state back to the 💎 emoji fallback; it never touches the
 * database, and the failure is keyed to the exact URL so a replaced/fixed
 * image URL always gets a fresh attempt.
 */
function FailedSafePackageImage({ pkg }: { pkg: TopUpPackage }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === pkg.imageUrl;
  if (failed) return <span className="text-2xl">💎</span>;
  return (
    <img
      src={pkg.imageUrl ?? undefined}
      alt={pkg.name}
      className="h-8 w-8 object-contain"
      onError={() => setFailedUrl(pkg.imageUrl ?? null)}
    />
  );
}

interface SelectedPackage {
  id: string;
  orderNumber: number;
  total: string;
  currency: string;
}

function formatPackageContent(pkg: TopUpPackage, legacyUnit: string): string {
  return pkg.content?.trim() || pkg.name.trim() || `${pkg.diamondAmount.toLocaleString()} ${legacyUnit}`;
}

export default function TopUpPage() {
  const { status: telegramStatus } = useTelegramAuth();
  const { t } = useTranslation();
  const [games, setGames] = useState<TopUpGame[]>([]);
  const [selectedGame, setSelectedGame] = useState<TopUpGame | null>(null);
  const [banners, setBanners] = useState<CustomerBanner[]>([]);
  const [packages, setPackages] = useState<TopUpPackage[]>([]);
  const [config, setConfig] = useState<TopUpGameConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [serverId, setServerId] = useState('');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [buying, setBuying] = useState(false);
  const [order, setOrder] = useState<SelectedPackage | null>(null);
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifiedAccountName, setVerifiedAccountName] = useState<string | null>(null);
  const [verifiedTarget, setVerifiedTarget] = useState<string | null>(null);
  const [verifiedServerId, setVerifiedServerId] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  // Provider-driven verification metadata (dynamic fields per game/category).
  const [verificationInfo, setVerificationInfo] = useState<TopUpVerificationInfo | null>(null);
  const [verificationValues, setVerificationValues] = useState<Record<string, string>>({});
  const [providerVerifiedName, setProviderVerifiedName] = useState<string | null>(null);

  const selectedPackage = useMemo(
    () => packages.find((pkg) => pkg.id === selectedPackageId) ?? null,
    [packages, selectedPackageId]
  );

  // Check if the LEGACY game-config verification is enabled (non-provider
  // flow). The provider-driven flow is decided by `verificationInfo`.
  const verificationEnabled = useMemo(
    () => config?.verificationEnabled ?? false,
    [config]
  );

  // Fetch live verification metadata whenever a package is selected. The
  // backend resolves package → provider service → external category and
  // checks FazerCards' validation-support catalog — never the frontend.
  useEffect(() => {
    if (!selectedPackage) {
      setVerificationInfo(null);
      setVerificationValues({});
      setProviderVerifiedName(null);
      return;
    }
    let cancelled = false;
    getTopUpVerificationInfo(selectedPackage.id)
      .then((info) => {
        if (!cancelled) {
          setVerificationInfo(info);
          setVerificationValues({});
          setProviderVerifiedName(null);
        }
      })
      .catch(() => {
        if (!cancelled) setVerificationInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPackage]);

  /** True when the provider supports validation for this exact category. */
  const providerVerificationAvailable = useMemo(
    () => verificationInfo?.verificationAvailable === true && verificationInfo.fields.length > 0,
    [verificationInfo]
  );

  /** Dynamic values → canonical order inputs (player_id→target, server_id→serverId, rest→customFields). */
  const applyVerificationValuesToOrderInputs = useCallback((values: Record<string, string>) => {
    const target = values['player_id'] ?? '';
    const serverId = values['server_id'] ?? '';
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (key !== 'player_id' && key !== 'server_id') extra[key] = value;
    }
    setTarget(target);
    setServerId(serverId);
    setCustomFieldValues((prev) => ({ ...prev, ...extra }));
  }, []);

  // Invalidate verification when target or serverId changes
  useEffect(() => {
    if (verified && (verifiedTarget !== target.trim() || verifiedServerId !== serverId.trim())) {
      setVerified(false);
      setVerifiedAccountName(null);
      setVerifiedTarget(null);
      setVerifiedServerId(null);
      setVerificationError(null);
    }
  }, [target, serverId, verified, verifiedTarget, verifiedServerId]);

  useEffect(() => {
    let cancelled = false;
    getTopUpGames()
      .then((result) => {
        if (cancelled) return;
        setGames(result.games);
        // Do NOT auto-select first game; wait for customer selection
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load top-up packages');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Category banners: resolve the Top-Up category by its canonical slug and
  // load banners targeted at it. Banners are optional, don't fail the page.
  useEffect(() => {
    if (telegramStatus !== 'ready') return;
    let cancelled = false;
    getCategories()
      .then((result) => findTopUpCategory(result.categories))
      .then(async (topUpCategory) => {
        if (cancelled || !topUpCategory) return;
        const bannerResult = await getBanners({ targetType: 'CATEGORY', categoryId: topUpCategory.id });
        if (!cancelled) setBanners(bannerResult.banners);
      })
      .catch(() => {
        // Banners are optional, don't fail the page
      });
    return () => {
      cancelled = true;
    };
  }, [telegramStatus]);

  useEffect(() => {
    if (!selectedGame) {
      setPackages([]);
      setConfig(null);
      setSelectedPackageId(null);
      setTarget('');
      setServerId('');
      setCustomFieldValues({});
      setVerified(false);
      setVerifiedAccountName(null);
      setVerifiedTarget(null);
      setVerifiedServerId(null);
      setVerificationError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTopUpPackages(selectedGame.id)
      .then((result) => {
        if (!cancelled) {
          setPackages(result.packages);
          setConfig(result.config);
          // Do NOT auto-select first package; wait for customer selection
          setSelectedPackageId(null);
          setTarget('');
          setServerId('');
          setCustomFieldValues({});
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load packages');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGame]);

  const formatPrice = useCallback((pkg: TopUpPackage) => {
    return pkg.currency === 'USD' ? '$' : `${pkg.currency} `;
  }, []);

  const totalPackages = useMemo(() => packages.length, [packages]);

  // Player ID is required when the game config says so, or by the legacy
  // default for provider-linked packages when no config exists.
  const playerIdRequired = useMemo(
    () => config?.requirePlayerId ?? selectedPackage?.requiresPlayerId ?? false,
    [config, selectedPackage]
  );
  const serverIdRequired = useMemo(() => config?.requireServerId ?? false, [config]);

  const playerIdValidation = useMemo(() => config?.playerIdValidation, [config]);
  const serverIdValidation = useMemo(() => config?.serverIdValidation, [config]);

  const handleCheck = async () => {
    if (!selectedGame || !config) return;

    // Validate target before checking
    if (!target.trim()) {
      setVerificationError(t('topUp.playerIDRequired'));
      return;
    }

    // Validate server ID if required
    if (config.requireServerId && !serverId.trim()) {
      setVerificationError(t('topUp.serverIDRequired'));
      return;
    }

    // Validate numeric format for Player ID
    if (playerIdValidation === 'NUMERIC' && !/^\d+$/.test(target.trim())) {
      setVerificationError(t('topUp.validNumericInput', { field: t('topUp.playerID') }));
      return;
    }

    // Validate numeric format for Server ID
    if (config.requireServerId && serverIdValidation === 'NUMERIC' && !/^\d+$/.test(serverId.trim())) {
      setVerificationError(t('topUp.validNumericInput', { field: t('topUp.serverID') }));
      return;
    }

    setVerifying(true);
    setVerificationError(null);

    try {
      const result = await verifyTopUpAccount({
        gameId: selectedGame.id,
        packageId: selectedPackage?.id,
        target: target.trim(),
        serverId: config.requireServerId ? serverId.trim() : undefined
      });

      if (result.success && result.accountName) {
        setVerified(true);
        setVerifiedAccountName(result.accountName);
        setVerifiedTarget(result.target ?? target.trim());
        setVerifiedServerId(result.serverId ?? serverId.trim());
        setVerificationError(null);
      } else {
        setVerified(false);
        setVerifiedAccountName(null);
        setVerifiedTarget(null);
        setVerifiedServerId(null);
        setVerificationError(result.error || t('topUp.verificationFailed'));
      }
    } catch {
      setVerified(false);
      setVerifiedAccountName(null);
      setVerifiedTarget(null);
      setVerifiedServerId(null);
      setVerificationError(t('topUp.verificationError'));
    } finally {
      setVerifying(false);
    }
  };

  const handleBuy = async () => {
    if (!selectedPackage) return;

    // Provider-driven flow: the backend REQUIRES a successful verification;
    // the frontend check here is only cosmetic.
    if (providerVerificationAvailable && !providerVerifiedName) {
      setError(t('topUp.mustVerify'));
      return;
    }
    // Provider cannot verify this game and purchases without it are disabled.
    if (
      verificationInfo?.applicable &&
      !verificationInfo.verificationAvailable &&
      !verificationInfo.allowUnverifiedPurchase
    ) {
      setError(t('topUp.verifyNotAvailable'));
      return;
    }

    // Legacy config-gated verification flow.
    if (!providerVerificationAvailable && verificationEnabled && !verified) {
      setError(t('topUp.mustVerify'));
      return;
    }

    // If verification is enabled and we have verified state, use the verified values
    const effectiveTarget = verificationEnabled && verified ? verifiedTarget ?? target.trim() : target.trim();
    const effectiveServerId = verificationEnabled && verified ? verifiedServerId ?? serverId.trim() : serverId.trim();

    if (playerIdRequired && !effectiveTarget) {
      setError(t('topUp.enterPlayerID'));
      return;
    }
    if (serverIdRequired && !effectiveServerId) {
      setError(t('topUp.enterServerID'));
      return;
    }
    for (const field of config?.customFields ?? []) {
      if (field.required && !(customFieldValues[field.key] ?? '').trim()) {
        setError(t('topUp.enterPlayerID'));
        return;
      }
    }

    setError(null);
    setBuying(true);
    try {
      const result = await createTopUpOrder({
        packageId: selectedPackage.id,
        target: playerIdRequired ? effectiveTarget : undefined,
        serverId: serverIdRequired ? effectiveServerId : undefined,
        customFields: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined,
        idempotencyKey: `topup_${selectedPackage.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      });
      setOrder({
        id: result.order.id,
        orderNumber: result.order.orderNumber,
        total: Number(result.order.total).toFixed(2),
        currency: result.order.currency
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('store.unableToLoad'));
    } finally {
      setBuying(false);
    }
  };

  if (telegramStatus !== 'ready') {
    return (
      <main className="min-h-screen bg-page bg-cosmic text-ink">
        <StoreHeader />
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:pb-16">
          <TelegramAuthNotice />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page text-ink">
      <StoreHeader />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6 md:pb-16">
        <section className="animate-fade-up relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-violet to-accent p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">{t('topUp.gameTopUp')}</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">{t('topUp.title')}</h1>
            <p className="mt-1 text-sm text-white/70">
              {t('topUp.subtitle')}
            </p>
          </div>
        </section>

        {/* Category Banners */}
        {banners.length > 0 && (
          <div className="mt-5">
            <BannerCarousel banners={banners} />
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            {error}
          </div>
        )}

        {order ? (
          <div className="mt-6">
            <PaymentActions
              orderId={order.id}
              orderNumber={order.orderNumber}
              orderStatus="DRAFT"
              orderTotal={order.total}
              orderCurrency={order.currency}
            />
            <button
              type="button"
              onClick={() => setOrder(null)}
              className="mt-4 text-sm text-soft underline-offset-2 transition-default hover:text-ink hover:underline"
            >
              {t('topUp.cancelAndChoose')}
            </button>
          </div>
        ) : (
          <>
            {games.length > 0 && (
              <div className="mt-6">
                <h2 className="text-lg font-bold tracking-tight text-ink">
                  {selectedGame ? selectedGame.name : t('topUp.chooseGame')}
                  {selectedGame && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGame(null);
                        setPackages([]);
                        setConfig(null);
                        setSelectedPackageId(null);
                        setTarget('');
                        setServerId('');
                        setCustomFieldValues({});
                        setError(null);
                        setVerified(false);
                        setVerifiedAccountName(null);
                        setVerifiedTarget(null);
                        setVerifiedServerId(null);
                        setVerificationError(null);
                      }}
                      className="ml-2 text-sm font-normal text-primary transition-default hover:text-primary-dark"
                    >
                      {t('topUp.changeGame')}
                    </button>
                  )}
                </h2>
                {!selectedGame ? (
                  <p className="mt-1 text-sm text-soft">{t('topUp.selectToSeePackages')}</p>
                ) : (
                  <p className="mt-1 text-sm text-soft">{totalPackages === 1 ? t('topUp.packagesAvailable', { total: String(totalPackages) }) : t('topUp.packagesAvailablePlural', { total: String(totalPackages) })}</p>
                )}
              </div>
            )}

            {!selectedGame ? (
              // STEP 1: GAME SELECTION
              <div className="mt-6">
                {loading ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {[1, 2, 3, 4].map((n) => (
                      <div key={n} className="skeleton h-36 rounded-2xl" />
                    ))}
                  </div>
                ) : games.length === 0 ? (
                  <div className="rounded-2xl card-cosmic p-6 text-center text-sm text-soft">
                    {t('topUp.noGamesConfigured')}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {games.map((game) => (
                      <button
                        key={game.id}
                        type="button"
                        onClick={() => setSelectedGame(game)}
                        className="group flex flex-col items-center gap-3 rounded-2xl card-cosmic p-5 text-center transition-default hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97]"
                      >
                        {game.imageUrl ? (
                          <FailedSafeGameImage game={game} />
                        ) : (
                          <span className="text-3xl">🎮</span>
                        )}
                        <span className="text-lg font-bold text-ink">{game.name}</span>
                        <span className="text-xs text-soft">{t('product.tapToView')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // STEP 2: PACKAGE SELECTION
              <div className="mt-6">
                {loading ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {[1, 2, 3, 4].map((n) => (
                      <div key={n} className="skeleton h-40 rounded-2xl" />
                    ))}
                  </div>
                ) : packages.length === 0 ? (
                  <div className="rounded-2xl card-cosmic p-6 text-center text-sm text-soft">
                    {t('topUp.noPackagesAvailable', { game: selectedGame?.name ?? '' })}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {packages.map((pkg) => (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => {
                          setSelectedPackageId(pkg.id);
                          setTarget('');
                          setServerId('');
                          setCustomFieldValues({});
                          setVerified(false);
                          setVerifiedAccountName(null);
                          setVerifiedTarget(null);
                          setVerifiedServerId(null);
                          setVerificationError(null);
                        }}
                        className={`group flex flex-col rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 ${
                          selectedPackageId === pkg.id
                            ? 'border-primary bg-primary/10'
                            : 'border-line bg-card hover:border-primary/40'
                        }`}
                      >
                        {pkg.imageUrl ? (
                          <FailedSafePackageImage pkg={pkg} />
                        ) : (
                          <span className="text-2xl">💎</span>
                        )}
                        <span className="mt-2 text-lg font-bold text-ink">
                          {formatPackageContent(pkg, t('topUp.diamonds'))}
                        </span>
                        <span className="mt-0.5 text-sm text-soft">{pkg.name}</span>
                         <span className="mt-3 inline-flex items-center justify-center rounded-xl bg-primary/15 px-3 py-2 text-sm font-semibold text-primary">
                          {formatPrice(pkg)}{Number(pkg.price).toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedPackage && !loading && (
                // STEP 3: CUSTOMER INFORMATION + STEP 4: NOTE + STEP 5: TOP UP
                <section className="mt-8 rounded-2xl card-cosmic p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">
                        {formatPackageContent(selectedPackage, t('topUp.diamonds'))} — {selectedPackage.name}
                      </p>
                      <p className="mt-0.5 text-sm text-soft">
                         {t('cart.price')}: <strong className="text-primary">{formatPrice(selectedPackage)}{Number(selectedPackage.price).toFixed(2)}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    {providerVerificationAvailable ? (
                      /* Provider-driven dynamic verification UI — works for any
                         game/category; fields come from FazerCards metadata. */
                      <AccountVerification
                        packageId={selectedPackage.id}
                        fields={verificationInfo?.fields ?? []}
                        values={verificationValues}
                        onValuesChange={(values) => {
                          setVerificationValues(values);
                          applyVerificationValuesToOrderInputs(values);
                        }}
                        onVerified={(playerName) => setProviderVerifiedName(playerName ?? '')}
                        onUnverified={() => setProviderVerifiedName(null)}
                      />
                    ) : (
                      <>
                        {verificationInfo?.applicable && !verificationInfo.allowUnverifiedPurchase && (
                          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                            ⚠ {t('topUp.verifyNotAvailable')}
                          </div>
                        )}
                        {playerIdRequired && (
                          <div>
                            <label htmlFor="topup-target" className="mb-1.5 block text-sm font-medium text-soft">
                              {t('topUp.playerID')} <span className="text-danger">*</span>
                            </label>
                            <input
                              id="topup-target"
                              type="text"
                              inputMode={playerIdValidation === 'NUMERIC' ? 'numeric' : 'text'}
                              pattern={playerIdValidation === 'NUMERIC' ? '[0-9]*' : undefined}
                              value={target}
                              onChange={(e) => {
                                const v = e.target.value;
                                setTarget(playerIdValidation === 'NUMERIC' ? v.replace(/[^0-9]/g, '') : v);
                              }}
                              placeholder={t('topUp.playerIDPlaceholder')}
                              maxLength={500}
                              className="w-full rounded-xl border border-line bg-card px-4 py-2.5 text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15"
                            />
                            {playerIdValidation === 'NUMERIC' && !/^\d+$/.test(target) && target.trim().length > 0 && (
                              <p className="mt-2 text-xs text-danger">{t('topUp.numericOnly', { field: t('topUp.playerID') })}</p>
                            )}
                          </div>
                        )}
                        {serverIdRequired && (
                          <div>
                            <label htmlFor="topup-server" className="mb-1.5 block text-sm font-medium text-soft">
                              {t('topUp.serverID')} <span className="text-danger">*</span>
                            </label>
                            <input
                              id="topup-server"
                              type="text"
                              inputMode={serverIdValidation === 'NUMERIC' ? 'numeric' : 'text'}
                              pattern={serverIdValidation === 'NUMERIC' ? '[0-9]*' : undefined}
                              value={serverId}
                              onChange={(e) => {
                                const v = e.target.value;
                                setServerId(serverIdValidation === 'NUMERIC' ? v.replace(/[^0-9]/g, '') : v);
                              }}
                              placeholder={t('topUp.serverIDPlaceholder')}
                              maxLength={100}
                              className="w-full rounded-xl border border-line bg-card px-4 py-2.5 text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15"
                            />
                            {serverIdValidation === 'NUMERIC' && !/^\d+$/.test(serverId) && serverId.trim().length > 0 && (
                              <p className="mt-2 text-xs text-danger">{t('topUp.numericOnly', { field: t('topUp.serverID') })}</p>
                            )}
                          </div>
                        )}
                        {verificationEnabled && (
                      <div>
                        {verified ? (
                          <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
                            <p className="font-medium">{t('topUp.accountVerified')}</p>
                            <p className="mt-1">{t('topUp.userName')}: {verifiedAccountName ?? ''}</p>
                            <p className="mt-1 text-soft">{t('topUp.gameID')}: {verifiedTarget ?? target.trim()}</p>
                            {verifiedServerId && <p className="mt-1 text-soft">{t('topUp.serverID')}: {verifiedServerId}</p>}
                            <button
                              type="button"
                              onClick={() => {
                                setVerified(false);
                                setVerifiedAccountName(null);
                                setVerifiedTarget(null);
                                setVerifiedServerId(null);
                                setVerificationError(null);
                              }}
                              className="mt-2 text-xs font-medium text-success/70 underline-offset-2 transition-default hover:text-success hover:underline"
                            >
                              {t('topUp.editID')}
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleCheck()}
                              disabled={verifying || !target.trim() || (playerIdValidation === 'NUMERIC' && target.trim().length > 0 && !/^\d+$/.test(target.trim())) || (config?.requireServerId && !serverId.trim()) || (config?.requireServerId && serverIdValidation === 'NUMERIC' && serverId.trim().length > 0 && !/^\d+$/.test(serverId.trim()))}
                              className="w-full rounded-xl border border-line bg-card px-6 py-2.5 font-semibold text-ink transition-default hover:border-primary/40 hover:bg-primary/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {verifying ? t('topUp.checking') : `🔍 ${t('topUp.check')}`}
                            </button>
                            {verificationError && (
                              <div className="mt-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                                <p className="font-medium">❌ {t('topUp.userIdInvalid')}</p>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                      </>
                    )}
                    {(config?.customFields ?? []).map((field) => (
                      <div key={field.key}>
                        <label htmlFor={`topup-field-${field.key}`} className="mb-1.5 block text-sm font-medium text-soft">
                          {field.label} {field.required && <span className="text-danger">*</span>}
                        </label>
                        <input
                          id={`topup-field-${field.key}`}
                          type="text"
                          value={customFieldValues[field.key] ?? ''}
                          onChange={(e) =>
                            setCustomFieldValues((values) => ({ ...values, [field.key]: e.target.value }))
                          }
                          placeholder={field.placeholder ?? field.label}
                          maxLength={500}
                          className="w-full rounded-xl border border-line bg-card px-4 py-2.5 text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15"
                        />
                      </div>
                    ))}
                    {config?.customerNote && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-50/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
                        <p className="font-medium text-amber-800 dark:text-amber-200">{t('topUp.note')}</p>
                        <p className="mt-1">{config.customerNote}</p>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleBuy()}
                    disabled={buying || (providerVerificationAvailable && !providerVerifiedName) || (verificationEnabled && !verified) || (playerIdRequired && !target.trim()) || (playerIdValidation === 'NUMERIC' && target.trim().length > 0 && !/^\d+$/.test(target.trim())) || (serverIdRequired && !serverId.trim()) || (serverIdValidation === 'NUMERIC' && serverId.trim().length > 0 && !/^\d+$/.test(serverId.trim()))}
                    className="mt-4 w-full rounded-xl bg-gradient-to-r from-primary to-violet px-6 py-3 font-semibold text-white shadow-md shadow-primary/20 transition-default hover:shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {buying ? t('topUp.creatingOrder') : t('topUp.topUpButton')}
                  </button>
                </section>
              )}
          </>
        )}

        <div className="mt-8 rounded-2xl card-cosmic p-5 text-sm text-soft">
          <p>
            <strong className="text-ink">{t('topUp.howItWorks')}</strong>{' '}
            {t('topUp.howItWorksDescription')}
          </p>
          <Link href="/store" className="mt-2 inline-block font-medium text-primary transition-default hover:text-primary-dark">
            {t('topUp.browseStore')}
          </Link>
        </div>
      </div>
    </main>
  );
}
