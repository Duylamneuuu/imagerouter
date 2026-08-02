import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { AppShell } from "@/components/AppShell";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata = {
  title: { default: "ImageRouter", template: "%s · ImageRouter" },
  description: "Local image-generation routing for MCP clients and developer tools.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
