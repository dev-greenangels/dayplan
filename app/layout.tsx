import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin', 'cyrillic'] })

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'PlanDay-GA',
  description: 'Планування робочого дня для Green Angels',
  applicationName: 'PlanDay-GA',
  robots: { index: false, follow: false },
  manifest: '/site.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'PlanDay-GA',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'PlanDay-GA',
    description: 'Планування робочого дня для Green Angels',
    siteName: 'PlanDay-GA',
    type: 'website',
    locale: 'uk_UA',
    images: [
      {
        url: '/web-app-manifest-512x512.png',
        width: 512,
        height: 512,
        alt: 'PlanDay-GA',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'PlanDay-GA',
    description: 'Планування робочого дня для Green Angels',
    images: ['/web-app-manifest-512x512.png'],
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#4a7c59',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="uk" className="bg-background" style={{ fontFamily: inter.style.fontFamily }}>
      <body className="antialiased font-sans">
        {children}
      </body>
    </html>
  )
}
