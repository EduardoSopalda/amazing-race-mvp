import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Fraunces, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Gab Lab dossier identity - self-hosted via next/font (no external request,
// no flash of unstyled text) rather than the design pack's own <link> tags.
const bebasNeue = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const fraunces = Fraunces({ weight: ["600", "700"], subsets: ["latin"], variable: "--font-serif" });
const ibmPlexMono = IBM_Plex_Mono({ weight: ["500", "700"], subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Barcelona Race",
  description: "A GPS team-building race around Barcelona.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bebasNeue.variable} ${fraunces.variable} ${ibmPlexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
