import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import LaunchSplash from '@/components/launch-splash'
import AppleStartupLinks from '@/components/apple-startup-links'

const inter = Inter({ subsets: ['latin', 'cyrillic'] })

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3000'

const launchBg = 'linear-gradient(135deg, #d4edda 0%, #e8f5e9 40%, #c8e6c9 100%)'

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
    // black-translucent helps launch chrome blend with splash on newer iOS
    statusBarStyle: 'black-translucent',
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
  other: {
    'mobile-web-app-capable': 'yes',
    // Next only emits the standard tag; older iOS still gates startup images on this one.
    'apple-mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#e8f5e9',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  // Android Chrome: resize layout with keyboard so focused inputs don't jump to mid-screen
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="uk"
      className="bg-background"
      style={{
        fontFamily: inter.style.fontFamily,
        background: launchBg,
      }}
    >
      <head>
        <AppleStartupLinks />
      </head>
      <body
        className="antialiased font-sans"
        style={{ background: launchBg }}
      >
        <LaunchSplash />
        {children}
      </body>
    </html>
  )
}
