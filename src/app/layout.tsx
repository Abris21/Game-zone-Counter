import './globals.css'
import PwaRegister from '@/components/PwaRegister'
import NavigationProgress from '@/components/NavigationProgress'
import { I18nProvider } from '@/lib/i18n'
import type { Metadata, Viewport } from 'next'
import { Sora, Inter, Noto_Sans_Ethiopic } from 'next/font/google'

const soraFont = Sora({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
})

const interFont = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const ethiopicFont = Noto_Sans_Ethiopic({
  subsets: ['ethiopic'],
  variable: '--font-am',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Gamezone Counter', template: '%s | Gamezone Counter' },
  description: 'Gamezone Counter for live sessions, shifts, inventory, finance, and tournament management.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/logo.png', apple: '/logo.png' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080B11',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Anti-flash theme init — must run before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  var t = localStorage.getItem('gz-theme') || 'dark';
                  document.documentElement.classList.add(t);
                } catch(e) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${soraFont.variable} ${interFont.variable} ${ethiopicFont.variable} font-sans bg-bg text-ink antialiased selection:bg-brand selection:text-bg`}
      >
        <I18nProvider>
          <NavigationProgress />
          {children}
        </I18nProvider>
        <PwaRegister />
      </body>
    </html>
  )
}
