import Link from 'next/link';
import type { ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  children: ReactNode;
  href?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-primary to-violet text-white font-semibold shadow-blue-sm hover:shadow-blue hover:-translate-y-0.5 active:scale-[0.97]',
  secondary:
    'border border-line/50 bg-card text-ink hover:border-primary/30 hover:text-primary hover:bg-primary-soft/30',
  ghost:
    'text-soft hover:bg-muted/60 hover:text-ink',
  danger:
    'border border-danger/20 bg-danger/10 text-danger hover:bg-danger/20 active:scale-[0.97]',
  accent:
    'bg-gradient-to-r from-accent to-violet text-white shadow-md shadow-accent/15 hover:shadow-lg hover:shadow-accent/25 active:scale-[0.97]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-xs rounded-xl',
  md: 'h-11 px-5 text-sm rounded-xl',
  lg: 'h-12 px-6 text-base rounded-xl',
};

export function Button({
  children,
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  disabled,
  onClick
}: ButtonProps) {
  const classes = `inline-flex items-center justify-center gap-2 font-semibold transition-luxury disabled:pointer-events-none disabled:opacity-40 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={classes}>
      {children}
    </button>
  );
}
