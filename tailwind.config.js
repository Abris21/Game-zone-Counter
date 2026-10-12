/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  // darkMode: 'class' allows both .dark and .light class-driven themes
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // App backgrounds — resolve from CSS vars so theme switching works
        bg:                 'var(--bg-app)',
        surface:            'var(--bg-surface)',
        'surface-elevated': 'var(--bg-elevated)',
        'surface-highlight':'var(--bg-highlight)',

        // Borders
        line:     'var(--border-line)',
        'line-gold': 'var(--border-line-gold)',

        // Typography
        ink:        'var(--color-ink)',
        'ink-muted':'var(--color-ink-muted)',
        'ink-dim':  'var(--color-ink-dim)',

        // Accent — Champagne Gold (spec: #D6B779 dark / #A78036 light)
        brand:        'var(--color-gold)',
        'brand-hover':'var(--color-gold-hover)',
        'brand-light':'var(--color-gold-muted)',

        // Full gold scale (dark-mode anchored values)
        gold: {
          DEFAULT: '#D6B779',
          50:  '#FDFBF4',
          100: '#FAF4E3',
          200: '#F5E6B3',
          300: '#EED683',
          400: '#E5CB96',
          500: '#D6B779',
          600: '#B89628',
          700: '#91741D',
          800: '#6B5416',
          900: '#4A3910',
        },

        // Status colors — exact spec values
        ok:      'var(--color-ok)',       // dark: #34D399  light: #059669
        warning: 'var(--color-warning)',  // dark: #FBBF24  light: #D97706
        bad:     'var(--color-bad)',      // dark: #FB7185  light: #E11D48

        // PlayStation button palette
        ps: {
          blue:     '#00439C',
          cyan:     '#0070D1',
          triangle: '#00F0FF',
          circle:   '#FF3366',
          cross:    '#3388FF',
          square:   '#FF66CC',
        },
      },

      fontFamily: {
        display: [
          'var(--font-display)',
          'Sora',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        sans: [
          'var(--font-sans)',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        am: ['var(--font-am)', 'Noto Sans Ethiopic', 'sans-serif'],
      },

      boxShadow: {
        glow:       'var(--shadow-glow)',
        'glow-sm':  'var(--shadow-glow-sm)',
        'glow-blue':'0 0 20px -3px rgba(0, 67, 156, 0.25)',
      },
    },
  },
  plugins: [],
}
