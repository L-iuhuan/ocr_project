/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#0891B2', dark: '#06B6D4', light: '#22D3EE' },
        surface: { light: '#ECFEFF', dark: '#0F172A' },
        panel: { light: '#FFFFFF', dark: '#1E293B' },
        cta: '#22C55E'
      },
      fontFamily: {
        heading: ['Fira Code', 'monospace'],
        body: ['Fira Sans', 'sans-serif']
      }
    }
  },
  plugins: []
};
