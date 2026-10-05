import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chapterly",
    short_name: "Chapterly",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1c1916",
    theme_color: "#1c1916",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
