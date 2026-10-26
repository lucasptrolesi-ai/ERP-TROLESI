import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trolesi ERP",
    short_name: "Trolesi ERP",
    description: "Sistema de gestão da Trolesi Joias",
    start_url: "/",
    display: "standalone",
    background_color: "#f9f8f6",
    theme_color: "#2c2520",
    lang: "pt-BR",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
