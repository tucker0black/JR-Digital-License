'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrDisplayProps {
  value?: string;
  alt?: string;
  className?: string;
  size?: number;
}

function isImageSource(value: string): boolean {
  return value.startsWith('data:image') || value.startsWith('http://') || value.startsWith('https://');
}

export function QrDisplay({ value, alt, className, size = 640 }: QrDisplayProps) {
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

    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: size,
      color: { dark: '#000000', light: '#FFFFFF' }
    })
      .then((url) => {
        if (!cancelled) setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setImageUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!value) return null;

  if (imageUrl) {
    const imgClass = className || 'h-auto w-full max-w-[320px] rounded-2xl border border-line bg-white p-3 shadow-sm';
    return (
      <img
        src={imageUrl}
        alt={alt || 'QR code'}
        className={imgClass}
        style={{ imageRendering: 'pixelated' }}
      />
    );
  }

  return (
    <code className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-muted/40 p-3 text-[11px] leading-relaxed text-ink">
      {value}
    </code>
  );
}
