import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'rgb(var(--page) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)',
        'primary-dark': 'rgb(var(--primary-dark) / <alpha-value>)',
        'primary-soft': 'rgb(var(--primary-soft) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        soft: 'rgb(var(--soft) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        violet: 'rgb(var(--violet) / <alpha-value>)',
        'violet-soft': 'rgb(var(--violet-soft) / <alpha-value>)',
        light: {
          bg: 'rgb(var(--page) / <alpha-value>)',
          card: 'rgb(var(--card) / <alpha-value>)',
          muted: 'rgb(var(--muted) / <alpha-value>)',
          primary: 'rgb(var(--primary) / <alpha-value>)',
          'primary-dark': 'rgb(var(--primary-dark) / <alpha-value>)',
          'primary-soft': 'rgb(var(--primary-soft) / <alpha-value>)',
          ink: 'rgb(var(--ink) / <alpha-value>)',
          'ink-soft': 'rgb(var(--soft) / <alpha-value>)',
          border: 'rgb(var(--line) / <alpha-value>)',
          success: 'rgb(var(--success) / <alpha-value>)',
          warning: 'rgb(var(--warning) / <alpha-value>)',
          danger: 'rgb(var(--danger) / <alpha-value>)'
        }
      },
      boxShadow: {
        glow: '0 0 24px rgb(var(--primary) / 0.25)',
        'glow-sm': '0 0 12px rgb(var(--primary) / 0.18)'
      }
    }
  },
  plugins: []
};

export default config;
