import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // Fotos do Vision AI (até 3 por peça) já vêm comprimidas no navegador, mas o
    // limite padrão de 1mb do Server Actions ainda é curto pra isso.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
