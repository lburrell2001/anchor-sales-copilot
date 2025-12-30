// src/app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: {
    default: "Anchor Sales Co-Pilot",
    template: "%s • Anchor Sales Co-Pilot",
  },
  description: "Docs • Specs • Install • Downloads",

  // ✅ App Router manifest route from src/app/manifest.ts
  manifest: "/manifest.webmanifest",

  // ✅ Proper PWA + iOS metadata
  applicationName: "Anchor Sales Co-Pilot",
  appleWebApp: {
    capable: true,
    title: "Anchor Co-Pilot",
    statusBarStyle: "black-translucent",
  },

  // ✅ These paths match your /public files (no /icons folder)
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
  },

 
};

export const viewport: Viewport = {
  themeColor: "#047835",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
