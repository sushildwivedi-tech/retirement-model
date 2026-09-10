import type { Metadata } from 'next';
import { IBM_Plex_Mono, Public_Sans, Spectral } from 'next/font/google';
import './globals.css';

/*
 * Three faces, three jobs. Spectral carries the headline number and the section titles;
 * Public Sans - drawn for public-sector documents, which is what every figure here is
 * traced to - carries the interface; IBM Plex Mono carries every number, so digits line
 * up whether they sit in a table, a chip or a field. Loaded through next/font so they
 * are self-hosted with the site and never flash.
 */
const display = Spectral({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});

const ui = Public_Sans({
  variable: '--font-ui',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Retirement model',
  description:
    'When can an Australian household stop working? Tax, super, the Age Pension, health and longevity - with every regulated figure traced to its source.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
