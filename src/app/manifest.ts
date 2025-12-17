// src/app/manifest.ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Anchor Sales Co-Pilot",
    short_name: "Anchor Co-Pilot",
    description: "Anchor Products sales assistant with instant docs + downloads.",
    start_url: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#047835",
    icons: [
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg", purpose: "maskable" },
      { src: "/apple-touch-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
