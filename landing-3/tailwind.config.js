/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0a0a',
        sub: '#52525b',
        faint: '#a1a1aa',
        line: '#e7e7e7',
        paper: '#ffffff',
        wash: '#fafafa',
        accent: '#1d4ed8',
      },
      fontFamily: {
        sans: ['Pretendard', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Inter', 'Pretendard', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      maxWidth: { content: '72rem' },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(22px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: { 'fade-up': 'fade-up 0.7s cubic-bezier(0.22,1,0.36,1) both' },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
