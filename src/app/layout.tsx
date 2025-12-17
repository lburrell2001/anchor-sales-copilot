import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Anchor Sales Co-Pilot",
  description: "Docs • Specs • Install • Downloads",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Anchor Co-Pilot",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg" },
      { url: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg" },
    ],
    apple: [{ url: "/apple-touch-icon.svg", sizes: "180x180", type: "image/svg" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#047835",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
