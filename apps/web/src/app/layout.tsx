import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { RegisterServiceWorker } from '@/components/service-worker';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'NaturalSpa', template: '%s · NaturalSpa' },
  description: 'Gestión de agenda, clientes y reservas de NaturalSpa',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'NaturalSpa', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#1f2a24',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-BO" className={inter.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
