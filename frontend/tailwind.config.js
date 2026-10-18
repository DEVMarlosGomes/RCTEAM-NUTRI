/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        // Geist no corpo; Archivo condensado (eixo wdth) nos titulos e numeros — linguagem atletica.
        sans: ['Geist', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Archivo', 'Geist', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
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
        // Neutros com leve tom azul-grafite (uma unica familia de cinza em todo o app)
        gray: {
          50: '#F4F6F8',
          100: '#E8ECF0',
          200: '#CFD6DE',
          300: '#AEB8C4',
          400: '#8A97A6',
          500: '#687586',
          600: '#4C5766',
          700: '#36404C',
          800: '#232A33',
          900: '#151A21',
          950: '#0C1015',
        },
        // Familias do Tailwind remapeadas para a paleta da marca, para telas antigas
        // que usam cores soltas: sucesso -> lima, info -> azul, erro -> coral, alerta -> ambar.
        emerald: {
          50: '#F6FEE4', 100: '#ECFDC6', 200: '#DEFB97', 300: '#D2FA66', 400: '#C3F53C',
          500: '#9BCB1F', 600: '#7AA216', 700: '#5C7A12', 800: '#425810', 900: '#2C3B0B',
        },
        green: {
          50: '#F6FEE4', 100: '#ECFDC6', 200: '#DEFB97', 300: '#D2FA66', 400: '#C3F53C',
          500: '#9BCB1F', 600: '#7AA216', 700: '#5C7A12', 800: '#425810', 900: '#2C3B0B',
        },
        cyan: {
          50: '#EEF6FF', 100: '#D6EAFF', 200: '#ADD5FF', 300: '#7ABDFF', 400: '#4DA6FF',
          500: '#1A8FFF', 600: '#0081FD', 700: '#0068D1', 800: '#0A4F9C', 900: '#0B3A70',
        },
        red: {
          50: '#FFF1EF', 100: '#FFDDD8', 200: '#FFBDB3', 300: '#FF9A8A', 400: '#FF6B57',
          500: '#F04A34', 600: '#D13A26', 700: '#A82E1F', 800: '#7F2519', 900: '#561A12',
        },
        amber: {
          50: '#FFF8EC', 100: '#FFEDCC', 200: '#FFDB99', 300: '#FFC970', 400: '#FFB547',
          500: '#F59E1F', 600: '#D17F0F', 700: '#A3610C', 800: '#76470B', 900: '#4D2F09',
        },
        yellow: {
          50: '#FFF8EC', 100: '#FFEDCC', 200: '#FFDB99', 300: '#FFC970', 400: '#FFB547',
          500: '#F59E1F', 600: '#D17F0F', 700: '#A3610C', 800: '#76470B', 900: '#4D2F09',
        },
        // Rogério Costa brand: azul da marca + verde-lima de nutricao/energia
        rc: {
          blue: '#0081FD',
          blueDark: '#0068D1',
          blueLight: '#4DA6FF',
          lime: '#C3F53C',
          limeDark: '#9BCB1F',
          amber: '#FFB547',
          coral: '#FF6B57',
          black: '#05070A',
          ink: '#090C10',
          surface: '#10151C',
          surfaceAlt: '#0C1016',
          raised: '#161C25',
          line: 'rgba(255,255,255,0.07)',
        },
        // Backwards-compat aliases usados pelas telas antigas
        evo: {
          bg: '#090C10',
          surface: '#10151C',
          surfaceAlt: '#0C1016',
          purple: '#0081FD',     // -> azul da marca
          teal: '#C3F53C',       // -> verde-lima (acentos de nutricao)
          amber: '#FFB547',
          coral: '#FF6B57',
        },
        // Macronutrientes: cores fixas em todos os graficos
        macro: {
          ptn: '#4DA6FF',
          cho: '#C3F53C',
          lip: '#FFB547',
        },
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.23, 1, 0.32, 1)',
        'in-out': 'cubic-bezier(0.77, 0, 0.175, 1)',
        drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'pulse-soft': { '0%,100%': { opacity: '0.6' }, '50%': { opacity: '1' } },
        'bar-grow': { '0%': { transform: 'scaleX(0)' }, '100%': { transform: 'scaleX(1)' } },
        'rc-glow': { '0%,100%': { opacity: '0.7' }, '50%': { opacity: '1' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s cubic-bezier(0.23, 1, 0.32, 1)',
        'accordion-up': 'accordion-up 0.18s cubic-bezier(0.23, 1, 0.32, 1)',
        'fade-up': 'fade-up 0.32s cubic-bezier(0.23, 1, 0.32, 1) both',
        'fade-in': 'fade-in 0.24s cubic-bezier(0.23, 1, 0.32, 1) both',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'bar-grow': 'bar-grow 0.7s cubic-bezier(0.23, 1, 0.32, 1) both',
        'rc-glow': 'rc-glow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
