'use client';

import { useRef, useState } from 'react';
import { uploadAdminMedia } from '@/lib/api-admin';
import { useBannerImage } from '@/components/use-banner-image';

/**
 * Admin image input for PERMANENT application-owned media.
 *
 * - "Upload" stores the chosen file via POST /api/admin/media and writes the
 *   returned stable `/api/media/…` URL into the form — the asset never expires
 *   and is never removed automatically.
 * - A manually pasted external URL remains supported but is labeled as such:
 *   its availability depends on the external host.
 * - The preview distinguishes "No image configured" from "Image unavailable"
 *   (URL stored but host failing). A load failure ONLY changes local UI
 *   state: it never clears the URL or mutates the record, and it resets
 *   automatically when the URL changes.
 */
export function MediaImageField({ label, value, onChange, aspect = 'square', hint }: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  /** Preview shape: square (logos/icons) or wide (banners). */
  aspect?: 'square' | 'wide';
  hint?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Local-only render lifecycle. Failure state resets when `value` changes,
  // so replacing the URL always gives the new image a clean chance.
  const { status, src, markLoaded, markFailed } = useBannerImage(value || null);

  const isOwnedUrl = value.startsWith('/api/media/');
  const previewClass = aspect === 'wide'
    ? 'relative aspect-[2048/896] w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-800'
    : 'relative h-20 w-20 overflow-hidden rounded-xl border border-slate-700 bg-slate-800';

  const handleFileChosen = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const { asset } = await uploadAdminMedia(btoa(binary));
      onChange(asset.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="sm:col-span-2">
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </label>
      <div className="flex flex-wrap items-start gap-3">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/api/media/… (uploaded) or https://… (external)"
          className="min-w-0 flex-1 basis-64 rounded-xl border border-line/50 bg-card px-4 py-2.5 text-sm text-ink transition-luxury focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:outline-none"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => void handleFileChosen(e.target.files?.[0])}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition-luxury hover:bg-primary/15 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : '⬆ Upload'}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        {hint ?? (isOwnedUrl
          ? 'Stored as a permanent application-owned asset — stays available until you replace or remove it.'
          : 'External URLs depend on the outside host. Prefer Upload so the image is stored permanently.')}
      </p>

      {uploadError && <p className="mt-1 text-xs text-red-400">{uploadError}</p>}

      <div className="mt-2">
        {status === 'no-url' ? (
          <div className={`${previewClass} flex items-center justify-center`}>
            <span className="text-xs text-slate-500">No image configured</span>
          </div>
        ) : (
          <div className={previewClass}>
            {status === 'ok' ? (
              <img
                src={src ?? undefined}
                alt={label}
                className="absolute inset-0 h-full w-full object-cover"
                onLoad={markLoaded}
                onError={markFailed}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-2 text-center">
                <span className="text-xs font-semibold text-amber-300">Image unavailable</span>
                <span className="text-[10px] leading-tight text-slate-400">
                  Saved URL could not be loaded — it is kept unchanged. Replace it above if the host is gone.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact table thumbnail with the same three-state contract. */
export function MediaThumb({ url, title }: { url: string | null | undefined; title: string }) {
  const { status, src, markLoaded, markFailed } = useBannerImage(url);
  if (status === 'no-url') {
    return (
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-[9px] text-slate-500"
        title="No image configured"
      >
        No img
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-500/10 px-0.5 text-center text-[8px] leading-tight text-amber-300"
        title={`A saved image URL exists but the host did not serve it. The stored URL is unchanged.\n${url ?? ''}`}
      >
        Unavailable
      </div>
    );
  }
  return (
    <img
      src={src ?? undefined}
      alt={title}
      className="h-10 w-10 rounded-lg object-cover"
      onLoad={markLoaded}
      onError={markFailed}
    />
  );
}
