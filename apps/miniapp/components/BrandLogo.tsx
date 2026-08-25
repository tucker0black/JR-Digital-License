import { appName } from '@jr/shared';
import Image from 'next/image';

interface BrandLogoProps {
  showName?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  /** Extra classes for the name span, e.g. to hide the text on very narrow screens. */
  nameClassName?: string;
}

export function BrandLogo({ showName = true, size = 'md', className = '', nameClassName = '' }: BrandLogoProps) {
  const logoSize = size === 'sm' ? 28 : 36;

  return (
    <span className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      <Image
        src="/jr-logo.webp"
        alt={`${appName} logo`}
        width={logoSize}
        height={logoSize}
        sizes={`${logoSize}px`}
        priority
        className="shrink-0 object-contain"
      />
      {showName && (
        <span
          className={`min-w-0 truncate font-bold tracking-tight text-ink ${nameClassName}`}
          style={{ fontSize: 'clamp(11px, 3.4vw, 14px)' }}
        >
          {appName}
        </span>
      )}
    </span>
  );
}
