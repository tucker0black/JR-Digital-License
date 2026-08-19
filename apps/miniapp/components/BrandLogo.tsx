import { appName } from '@jr/shared';
import Image from 'next/image';

interface BrandLogoProps {
  showName?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function BrandLogo({ showName = true, size = 'md', className = '' }: BrandLogoProps) {
  const logoSize = size === 'sm' ? 28 : 36;

  return (
    <span className={`flex shrink-0 items-center gap-2.5 ${className}`}>
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
        <span className="shrink-0 whitespace-nowrap text-xs font-bold tracking-tight text-ink min-[380px]:text-sm">
          {appName}
        </span>
      )}
    </span>
  );
}
