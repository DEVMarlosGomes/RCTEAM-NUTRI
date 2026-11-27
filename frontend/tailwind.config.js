/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        // Identidade Rogério Costa: Pirulen nos títulos e números grandes, DIN nos textos.
        // Substitutas web (as mesmas do canvas da marca): Michroma e Barlow.
        sans: ['"DIN 2014"', 'DIN', 'Barlow', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Pirulen', 'Michroma', 'Barlow', 'system-ui', 'sans-serif'],
        condensed: ['"Barlow Condensed"', 'Barlow', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        none: '0', sm: '0', DEFAULT: '0', md: '0', lg: '0', xl: '0', '2xl': '0', '3xl': '0', full: '9999px',
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
          50: '#F5F6F7',
          100: '#E9EBEE',
          200: '#D3D7DC',
          300: '#BCC3CB',
          400: '#9AA3AE',
          500: '#7A838F',
          600: '#5A636E',
          700: '#2B3440',
          800: '#1A1F26',
          900: '#11151A',
          950: '#0B0D10',
        },
        // Familias do Tailwind remapeadas para a paleta da marca, para telas antigas
        // que usam cores soltas: sucesso -> lima, info -> azul, erro -> coral, alerta -> ambar.
        emerald: {
          50: '#ECFBF3', 100: '#D2F6E2', 200: '#A6EDC6', 300: '#6FE3A6', 400: '#3DDC84',
          500: '#2BB86B', 600: '#209457', 700: '#197445', 800: '#135634', 900: '#0C3A23',
        },
        green: {
          50: '#ECFBF3', 100: '#D2F6E2', 200: '#A6EDC6', 300: '#6FE3A6', 400: '#3DDC84',
          500: '#2BB86B', 600: '#209457', 700: '#197445', 800: '#135634', 900: '#0C3A23',
        },
        cyan: {
          50: '#EEF6FF', 100: '#D6EAFF', 200: '#ADD5FF', 300: '#7ABDFF', 400: '#4DA6FF',
          500: '#1A8FFF', 600: '#0081FD', 700: '#0068D1', 800: '#0A4F9C', 900: '#0B3A70',
        },
        red: {
          50: '#FFF1F1', 100: '#FFDCDD', 200: '#FFBCBE', 300: '#FF9497', 400: '#FF5A5F',
          500: '#F04449', 600: '#D13A26', 700: '#A82E1F', 800: '#7F2519', 900: '#561A12',
        },
        amber: {
          50: '#FFF7EC', 100: '#FFEBCC', 200: '#FFD699', 300: '#FFC170', 400: '#FFA53B',
          500: '#F59E1F', 600: '#D17F0F', 700: '#A3610C', 800: '#76470B', 900: '#4D2F09',
        },
        yellow: {
          50: '#FFF7EC', 100: '#FFEBCC', 200: '#FFD699', 300: '#FFC170', 400: '#FFA53B',
          500: '#F59E1F', 600: '#D17F0F', 700: '#A3610C', 800: '#76470B', 900: '#4D2F09',
        },
        // Rogério Costa brand: azul da marca + verde-lima de nutricao/energia
        rc: {
          blue: '#0081FD',
          blueDark: '#0068D1',
          blueLight: '#4DA6FF',
          // "lime" virou o verde de status da marca (meta atingida); não é mais cor de ação
          lime: '#3DDC84',
          limeDark: '#2BB86B',
          amber: '#FFA53B',
          coral: '#FF5A5F',
          black: '#000000',
          ink: '#000000',
          surface: '#0B0D10',
          surfaceAlt: '#06080A',
          raised: '#12161B',
          line: '#1A1F26',
          border: '#2B3440',
          muted: '#9AA3AE',
        },
        // Backwards-compat aliases usados pelas telas antigas
        evo: {
          bg: '#000000',
          surface: '#0B0D10',
          surfaceAlt: '#06080A',
          purple: '#0081FD',     // -> azul da marca
          teal: '#3DDC84',       // -> verde de status
          amber: '#FFA53B',
          coral: '#FF5A5F',
        },
        // Macronutrientes: cores fixas em todos os graficos
        macro: {
          cho: '#FFFFFF',
          ptn: '#0081FD',
          lip: '#7FC0FF',
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
