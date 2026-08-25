'use client';

import { useMemo, useState } from 'react';
import { verifyTopUpPlayer, type TopUpVerificationField } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';

/**
 * Generic account verification UI for game top-ups.
 *
 * Fully provider-driven: the required inputs come from backend metadata
 * (`fields` — straight from the provider's validation-support catalog), so
 * this component works for ANY game without code changes. It never decides
 * category ids and never fakes a result.
 */
export interface AccountVerificationProps {
  packageId: string;
  fields: TopUpVerificationField[];
  values: Record<string, string>;
  onValuesChange: (values: Record<string, string>) => void;
  /** Called after a successful verification with the provider's player name. */
  onVerified: (playerName: string | null) => void;
  /** Called whenever verification is (or becomes) invalid/expired. */
  onUnverified?: () => void;
}

type VerifyState =
  | { phase: 'idle' }
  | { phase: 'verifying' }
  | { phase: 'valid'; playerName: string | null; verifiedValues: Record<string, string> }
  | { phase: 'invalid'; message: string; hint?: string }
  | { phase: 'unavailable'; message: string; hint?: string };

/**
 * Customer-safe reason → generic store message. Supplier identity, HTTP
 * status and raw supplier errors NEVER appear here — the backend already
 * sanitizes; this mapping only picks which generic copy to show.
 */
function customerMessageFor(reason: string | null, backendError: string | null, t: (key: string) => string): { message: string; hint?: string } {
  switch (reason) {
    case 'PLAYER_NOT_FOUND':
      return { message: t('topUp.playerNotFound'), hint: t('topUp.playerNotFoundHint') };
    case 'VALIDATION_NOT_SUPPORTED':
      return { message: t('topUp.verifyNotAvailable') };
    default:
      // VERIFICATION_UNAVAILABLE and any unknown/unmapped reason fall back to
      // the same generic temporary-unavailability message.
      return { message: t('topUp.verifyUnavailable'), hint: t('topUp.verifyUnavailableHint') };
  }
}

export function AccountVerification({ packageId, fields, values, onValuesChange, onVerified, onUnverified }: AccountVerificationProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<VerifyState>({ phase: 'idle' });
  const [localError, setLocalError] = useState<string | null>(null);

  // A change in ANY field value immediately invalidates a previous result.
  const currentValues = useMemo(() => {
    const trimmed: Record<string, string> = {};
    for (const field of fields) trimmed[field.key] = (values[field.key] ?? '').trim();
    return trimmed;
  }, [fields, values]);

  const allFilled = fields.every((field) => (currentValues[field.key] ?? '').length > 0);

  const invalidate = () => {
    setState((prev) => {
      if (prev.phase === 'valid') {
        onUnverified?.();
      }
      return { phase: 'idle' };
    });
  };

  const handleVerify = async () => {
    if (state.phase === 'verifying') return; // duplicate-click guard
    setLocalError(null);

    for (const field of fields) {
      if (!currentValues[field.key]) {
        setLocalError(`'${field.label}' is required`);
        return;
      }
    }

    setState({ phase: 'verifying' });

    try {
      const result = await verifyTopUpPlayer({ packageId, fields: currentValues });

      if (result.valid === true && result.verified) {
        setState({ phase: 'valid', playerName: result.playerName, verifiedValues: currentValues });
        onVerified(result.playerName);
        return;
      }

      if (result.reason === 'VALIDATION_NOT_SUPPORTED') {
        setState({ phase: 'unavailable', ...customerMessageFor(result.reason, result.error, t) });
        return;
      }

      if (result.reason === 'VERIFICATION_UNAVAILABLE') {
        // Supplier outage/auth/subscription issue — generic temporary message.
        setState({ phase: 'unavailable', ...customerMessageFor(result.reason, null, t) });
        return;
      }

      if (result.reason === 'PLAYER_NOT_FOUND') {
        setState({ phase: 'invalid', ...customerMessageFor(result.reason, null, t) });
        return;
      }

      // Field-level problems (MISSING_FIELDS/UNKNOWN_FIELD): the backend error
      // here is already a customer-safe, supplier-blind string.
      setState({ phase: 'invalid', message: result.error ?? t('topUp.verificationFailed') });
    } catch {
      // Network failure talking to OUR backend — still no supplier details exist.
      setState({ phase: 'unavailable', message: t('topUp.verifyUnavailable'), hint: t('topUp.verifyUnavailableHint') });
    }
  };

  const verifiedResult = state.phase === 'valid' ? state : null;
  const changedAfterVerification =
    verifiedResult !== null &&
    fields.some((field) => verifiedResult.verifiedValues[field.key] !== currentValues[field.key]);

  return (
    <div>
      {fields.map((field) => (
        <div key={field.key} className={field === fields[0] ? '' : 'mt-3'}>
          <label htmlFor={`verify-${field.key}`} className="mb-1.5 block text-sm font-medium text-soft">
            {field.label} <span className="text-danger">*</span>
          </label>
          <input
            id={`verify-${field.key}`}
            type="text"
            inputMode={field.type === 'numeric' || field.key.toLowerCase().includes('id') ? 'text' : 'text'}
            value={values[field.key] ?? ''}
            onChange={(e) => {
              onValuesChange({ ...values, [field.key]: e.target.value });
              if (state.phase !== 'idle') invalidate();
            }}
            maxLength={100}
            autoComplete="off"
            className="w-full rounded-xl border border-line bg-card px-4 py-2.5 text-ink outline-none transition-default focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </div>
      ))}

      {!verifiedResult && (
        <button
          type="button"
          onClick={() => void handleVerify()}
          disabled={state.phase === 'verifying' || !allFilled}
          className="mt-3 w-full rounded-xl border border-primary/40 bg-primary/10 px-6 py-2.5 font-semibold text-primary transition-default hover:bg-primary/15 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.phase === 'verifying'
            ? `⏳ ${t('topUp.verifyingAccount')}`
            : `🛡 ${t('topUp.verifyAccountButton')}`}
        </button>
      )}

      {verifiedResult && (
        <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <p className="font-medium">✓ {t('topUp.accountFound')}</p>
          {verifiedResult.playerName && (
            <p className="mt-1">
              {t('topUp.playerLabel')}: <strong>{verifiedResult.playerName}</strong>
            </p>
          )}
          <button
            type="button"
            onClick={() => invalidate()}
            className="mt-2 text-xs font-medium text-success/70 underline-offset-2 transition-default hover:text-success hover:underline"
          >
            {t('topUp.editID')}
          </button>
        </div>
      )}

      {changedAfterVerification && (
        <p className="mt-2 text-xs text-warning">{t('topUp.valuesChanged')}</p>
      )}

      {state.phase === 'invalid' && (
        <div className="mt-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <p className="font-medium">✕ {state.message}</p>
          {state.hint && <p className="mt-1">{state.hint}</p>}
        </div>
      )}

      {state.phase === 'unavailable' && (
        <div className="mt-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="font-medium">⚠️ {state.message}</p>
          {state.hint && <p className="mt-1">{state.hint}</p>}
        </div>
      )}

      {localError && <p className="mt-2 text-xs text-danger">{localError}</p>}
    </div>
  );
}
