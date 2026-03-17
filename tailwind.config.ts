import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1c2d4a',
          deep: '#0f1d30',
          card: '#243556',
          light: '#2d4468',
          border: '#344d6e',
        },
        orange: {
          DEFAULT: '#f5a623',
          dark: '#d4881a',
          light: '#f7b94d',
          subtle: 'rgba(245,166,35,0.12)',
        },
      },
      fontFamily: {
        display: ['var(--font-barlow)', 'system-ui', 'sans-serif'],
        body: ['var(--font-source-sans)', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'dot-pattern': 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
        'dot-pattern-dark': 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
      },
      backgroundSize: {
        'dot-sm': '20px 20px',
        'dot-md': '28px 28px',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideRight: {
          '0%': { transform: 'translateX(-8px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.5s ease-out forwards',
        'fade-up-delay-1': 'fadeUp 0.5s ease-out 0.1s forwards',
        'fade-up-delay-2': 'fadeUp 0.5s ease-out 0.2s forwards',
        'fade-up-delay-3': 'fadeUp 0.5s ease-out 0.3s forwards',
        'fade-up-delay-4': 'fadeUp 0.5s ease-out 0.4s forwards',
        'fade-in': 'fadeIn 0.4s ease-out forwards',
      },
    },
  },
  plugins: [],
}

export default config
