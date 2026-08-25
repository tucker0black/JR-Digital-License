import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        page: 'rgb(var(--page) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        'card-elevated': 'rgb(var(--card-elevated) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)',
        'primary-dark': 'rgb(var(--primary-dark) / <alpha-value>)',
        'primary-light': 'rgb(var(--primary-light) / <alpha-value>)',
        'primary-soft': 'rgb(var(--primary-soft) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        soft: 'rgb(var(--soft) / <alpha-value>)',
        'muted-text': 'rgb(var(--muted-text) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        'success-soft': 'rgb(var(--success-soft) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        'warning-soft': 'rgb(var(--warning-soft) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        'danger-soft': 'rgb(var(--danger-soft) / <alpha-value>)',
        violet: 'rgb(var(--violet) / <alpha-value>)',
        'violet-soft': 'rgb(var(--violet-soft) / <alpha-value>)',
      },
      boxShadow: {
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
        'glow': '0 0 24px rgba(59, 130, 246, 0.18)',
        'glow-sm': '0 0 12px rgba(59, 130, 246, 0.12)',
        'glow-accent': '0 0 20px rgba(139, 92, 246, 0.15)',
        'glow-subtle': '0 0 32px rgba(59, 130, 246, 0.06)',
        'blue': '0 4px 24px rgba(59, 130, 246, 0.2)',
        'blue-sm': '0 2px 12px rgba(59, 130, 246, 0.15)',
        'purple': '0 4px 24px rgba(139, 92, 246, 0.2)',
        'premium': '0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(59, 130, 246, 0.06)',
      },
      borderRadius: {
        '2xl': '14px',
        '3xl': '20px',
        '4xl': '28px',
      },
      animation: {
        'fade-up': 'fade-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 0.25s ease-out both',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
        'pulse-glow': 'pulse-glow 2.5s ease-in-out infinite',
      },
      transitionTimingFunction: {
        'luxury': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      backgroundImage: {
        'gradient-primary': 'var(--gradient-primary)',
        'gradient-accent': 'var(--gradient-accent)',
        'gradient-wallet': 'var(--gradient-wallet)',
        'gradient-hero': 'var(--gradient-hero)',
        'gradient-surface': 'var(--gradient-surface)',
      },
      letterSpacing: {
        'premium': '-0.02em',
        'wide-premium': '0.06em',
      },
    }
  },
  plugins: []
};

export default config;
