'use client';

import { useState } from 'react';

interface CategoryIconProps {
  imageUrl?: string | null;
  icon?: string | null;
  name: string;
  size?: 'md' | 'lg';
}

const IMAGE_CLASSES = {
  md: 'flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-primary-soft',
  lg: 'flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-primary-soft'
};

const EMOJI_CLASSES = {
  md: 'flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-lg',
  lg: 'flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-xl'
};

const FALLBACK_CLASSES = {
  md: 'flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-sm font-bold text-soft',
  lg: 'flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-base font-bold text-soft'
};

export function CategoryIcon({ imageUrl, icon, name, size = 'md' }: CategoryIconProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const url = imageUrl?.trim() ?? '';
  const hasValidUrl = url.length > 0 && /^https?:\/\//i.test(url);

  if (hasValidUrl && !imageFailed) {
    return (
      <span className={IMAGE_CLASSES[size]}>
        <img
          src={url}
          alt={name}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      </span>
    );
  }

  if (icon && icon.trim().length > 0) {
    return <span className={EMOJI_CLASSES[size]}>{icon}</span>;
  }

  return <span className={FALLBACK_CLASSES[size]}>{name.charAt(0)}</span>;
}