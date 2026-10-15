import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Amor X Carmen",
  description: "Rutas y ubicación compartida de los camiones de Ciudad del Carmen.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
