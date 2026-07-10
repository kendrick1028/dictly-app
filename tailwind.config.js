/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dictly palette — accent is a runtime CSS var (theme: gray default / green optional)
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)'
        },
        panel: '#ffffff',
        canvas: '#f7f7f5',
        sidebar: '#f3f3f1',
        ink: '#1f2329',
        subtle: '#8a8f98'
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Pretendard',
          'Apple SD Gothic Neo',
          'Segoe UI',
          'sans-serif'
        ]
      }
    }
  },
  plugins: []
}
