/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./App.tsx",
    "./**/*.{js,ts,jsx,tsx,html}",
    "!./node_modules/**/*",
    "!./dist/**/*"
  ],
  theme: {
    extend: {
      colors: {
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
          900: '#164e63',
        },
        black: '#000000',
        gray: {
          900: '#101010',
          800: '#1a1a1a',
        }
      },
      fontFamily: {
        mono: ['"Courier New"', 'Courier', 'monospace'],
        sans: ['system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
};

