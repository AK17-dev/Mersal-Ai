/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
        arabic: ['"IBM Plex Sans Arabic"', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#f4f6fb',
          100: '#e8ecf6',
          200: '#cbd5ec',
          300: '#9fb3dc',
          400: '#6c8bc8',
          500: '#486cb2',
          600: '#375294',
          700: '#2e4379',
          800: '#2a3b66',
          900: '#273457',
          950: '#1b223b',
        }
      }
    },
  },
  plugins: [],
}
