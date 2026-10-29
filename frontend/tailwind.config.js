/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './privacy.html',
    './**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: 'var(--ink)',
          soft: 'var(--ink-soft)',
          muted: 'var(--ink-muted)',
          border: 'var(--ink-border)',
        },
        band: {
          DEFAULT: 'var(--band)',
          dim: 'var(--band-dim)',
          mute: 'var(--band-mute)',
        },
      },
      borderRadius: {
        cm: 'var(--radius-md)',
      },
      boxShadow: {
        cm: 'var(--shadow-card)',
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'mark-reveal': {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'bands-pulse': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.55s ease-out both',
        'fade-in': 'fade-in 0.4s ease-out both',
        'mark-reveal': 'mark-reveal 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        'bands-pulse': 'bands-pulse 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
