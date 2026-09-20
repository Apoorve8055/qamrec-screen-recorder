/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      /*
       * Qamrec design system: near-black surfaces, one violet→ember gradient for "on",
       * red reserved for REC / Stop / Export, yellow for trim handles and highlights.
       */
      colors: {
        abyss: '#050507',
        ink: '#0A0A0E',
        deep: '#08080A',
        well: '#0E0E14',
        card: '#18181F',
        raised: '#1E1E26',
        lift: '#1A1A22',
        line: { DEFAULT: '#2A2A32', strong: '#3A3A44', faint: '#1E1E26' },
        fog: '#9A9AA3',
        paper: '#F5F5F0',
        violet: '#A855F7',
        ember: '#FB7C2C',
        rec: { DEFAULT: '#FF3B30', hover: '#FF4D42' },
        mark: '#FFD60A',
        // Neutral scale re-tuned to the system so older gray-* utilities stay on palette
        gray: {
          50: '#FAFAF7',
          100: '#F5F5F0',
          200: '#E2E2DF',
          300: '#C4C4C9',
          400: '#9A9AA3',
          500: '#6E6E78',
          600: '#3A3A44',
          700: '#2A2A32',
          800: '#18181F',
          900: '#0A0A0E',
          950: '#08080A',
        },
        // Accent scale (violet), used for links and focus
        primary: {
          50: '#FAF5FF',
          100: '#F3E8FF',
          200: '#E9D5FF',
          300: '#D8B4FE',
          400: '#C084FC',
          500: '#A855F7',
          600: '#9333EA',
          700: '#7E22CE',
          800: '#6B21A8',
          900: '#581C87',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        accent: 'linear-gradient(to right, #A855F7, #FB7C2C)',
        'accent-br': 'linear-gradient(to bottom right, #A855F7, #FB7C2C)',
        'accent-b': 'linear-gradient(to bottom, #A855F7, #FB7C2C)',
      },
      boxShadow: {
        glow: '0 0 12px rgba(168, 85, 247, 0.3)',
        orb: '0 2px 10px rgba(168, 85, 247, 0.4)',
        rec: '0 2px 12px rgba(255, 59, 48, 0.4)',
        panel: '0 24px 80px rgba(0, 0, 0, 0.6)',
      },
      keyframes: {
        blink: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        blink: 'blink 1s steps(2) infinite',
        shimmer: 'shimmer 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
