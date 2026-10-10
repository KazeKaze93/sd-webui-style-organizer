/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'sg-bg': 'rgb(var(--sg-bg) / <alpha-value>)',
        'sg-surface': 'rgb(var(--sg-surface) / <alpha-value>)',
        'sg-popover': 'rgb(var(--sg-popover) / <alpha-value>)',
        'sg-border': 'rgb(var(--sg-border) / <alpha-value>)',
        'sg-text': 'rgb(var(--sg-text) / <alpha-value>)',
        'sg-muted': 'rgb(var(--sg-muted) / <alpha-value>)',
        'sg-accent': 'rgb(var(--sg-accent) / <alpha-value>)',
        'sg-accent-text': 'rgb(var(--sg-accent-text) / <alpha-value>)',
        'sg-success': 'rgb(var(--sg-success) / <alpha-value>)',
        'sg-success-text': 'rgb(var(--sg-success-text) / <alpha-value>)',
        'sg-danger': 'rgb(var(--sg-danger) / <alpha-value>)',
        'sg-danger-text': 'rgb(var(--sg-danger-text) / <alpha-value>)',
        'sg-warning-text': 'rgb(var(--sg-warning-text) / <alpha-value>)',
        'sg-info': 'rgb(var(--sg-info) / <alpha-value>)',
        'sg-wildcard': 'rgb(var(--sg-wildcard) / <alpha-value>)',
        'sg-wildcard-text': 'rgb(var(--sg-wildcard-text) / <alpha-value>)',
        // shadcn (CSS variables)
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
        },
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
