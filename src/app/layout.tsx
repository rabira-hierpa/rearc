import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { PrelineLoader } from "@/components/preline/PrelineLoader";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ReArc — transport network analysis with ArcGIS + Next.js",
  description:
    "A Google-Maps-style transport network analysis app built with the ArcGIS Maps SDK 5, Next.js 16, Tailwind CSS v4 and Preline UI.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // A map app manages its own gestures; page pinch-zoom fights the map.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden bg-gray-100">
        {children}
        <PrelineLoader />
      </body>
    </html>
  );
}
