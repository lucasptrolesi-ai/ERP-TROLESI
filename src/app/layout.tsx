import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Montserrat } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Trolesi ERP",
  description: "Sistema de gestão da Trolesi Joias",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Trolesi ERP",
  },
};

export const viewport: Viewport = {
  themeColor: "#2c2520",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${cormorant.variable} ${montserrat.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
