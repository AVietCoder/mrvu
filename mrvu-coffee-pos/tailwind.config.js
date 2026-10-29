/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff1f1', 100: '#ffe0e0', 200: '#ffc6c6', 300: '#ff9c9c', 400: '#ff6161',
          500: '#f03a3a', 600: '#d81f26', 700: '#b3151c', 800: '#94161b', 900: '#7a181c',
        },
      },
      fontFamily: { sans: ['"Be Vietnam Pro"', 'system-ui', 'Segoe UI', 'sans-serif'] },
    },
  },
  plugins: [],
}
