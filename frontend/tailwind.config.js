/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        // Pirulen has no free web license — Orbitron is the closest geometric/futuristic free Google Font.
        sans: ['Rajdhani', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Orbitron', 'Rajdhani', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        // Rogério Costa brand
        rc: {
          blue: '#0081FD',
          blueDark: '#0066CC',
          blueLight: '#3DA0FF',
          black: '#000000',
          ink: '#0A0E14',
          surface: '#0F141B',
          surfaceAlt: '#070B11',
          line: 'rgba(255,255,255,0.08)',
        },
        // Backwards-compat aliases (so existing `evo-*` classes keep working with new palette)
        evo: {
          bg: '#0A0E14',
          surface: '#0F141B',
          surfaceAlt: '#070B11',
          purple: '#0081FD',     // remapped → blue
          teal: '#0066CC',       // remapped → dark blue (gradient end)
          amber: '#FFB347',
          coral: '#FF5A4D',
        },
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'pulse-soft': { '0%,100%': { opacity: '0.6' }, '50%': { opacity: '1' } },
        'rc-glow': { '0%,100%': { boxShadow: '0 0 24px rgba(0,129,253,0.35)' }, '50%': { boxShadow: '0 0 40px rgba(0,129,253,0.65)' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-up': 'fade-up 0.4s ease-out both',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'rc-glow': 'rc-glow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
