'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrDisplayProps {
  value?: string;
  alt?: string;
  className?: string;
}

function isImageSource(value: string): boolean {
  return value.startsWith('data:image') || value.startsWith('http://') || value.startsWith('https://');
}

export function QrDisplay({ value, alt, className }: QrDisplayProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!value) {
      setImageUrl(null);
      return;
    }

    if (isImageSource(value)) {
      setImageUrl(value);
      return;
    }

    QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: 512 })
      .then((url) => {
        if (!cancelled) setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setImageUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!value) return null;

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={alt || 'QR code'}
        className={className || 'h-56 w-56 rounded-xl border border-line bg-white p-2 shadow-sm'}
      />
    );
  }

  return (
    <code className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-muted/40 p-3 text-[11px] leading-relaxed text-ink">
      {value}
    </code>
  );
}
