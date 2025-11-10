import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          dark: 'hsl(var(--primary-dark))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
          dark: 'hsl(var(--secondary-dark))'
        },
        tertiary: 'hsl(var(--tertiary))',
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
          pink: 'hsl(var(--accent-pink))',
          blue: 'hsl(var(--accent-blue))',
          green: 'hsl(var(--accent-green))',
          lime: 'hsl(var(--accent-lime))',
          orange: 'hsl(var(--accent-orange))',
          amber: 'hsl(var(--accent-amber))',
          purple: 'hsl(var(--accent-purple))',
          indigo: 'hsl(var(--accent-indigo))',
          cyan: 'hsl(var(--accent-cyan))',
          teal: 'hsl(var(--accent-teal))',
          emerald: 'hsl(var(--accent-emerald))',
          mint: 'hsl(var(--accent-mint))',
          sage: 'hsl(var(--accent-sage))',
          olive: 'hsl(var(--accent-olive))',
          brown: 'hsl(var(--accent-brown))',
          gold: 'hsl(var(--accent-gold))',
          silver: 'hsl(var(--accent-silver))',
          slate: 'hsl(var(--accent-slate))',
          rose: 'hsl(var(--accent-rose))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      backgroundImage: {
        'hero-radial':
          'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.15), transparent 55%), radial-gradient(circle at 80% 10%, rgba(255,255,255,0.12), transparent 50%)'
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      },
      container: {
        center: true,
        padding: '2rem',
        screens: {
          '2xl': '1400px'
        }
      }
    }
  },
  plugins: [animate]
} satisfies Config

export default config

