// src/app/layout.tsx
import "./globals.css";

export const metadata = {
  title: {
    default: "Anchor Sales Co-Pilot",
    template: "%s • Anchor Sales Co-Pilot",
  },
  description: "Docs • Specs • Install • Downloads",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* === PWA MANIFEST (required for Chrome / Android detection) === */}
        <link rel="manifest" href="/manifest.webmanifest" />

        {/* === Theme + mobile behavior === */}
        <meta name="theme-color" content="#047835" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Anchor Co-Pilot" />

        {/* === Icons === */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* === Viewport (safe for PWA + iOS) === */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>

      <body>{children}</body>
    </html>
  );
}
