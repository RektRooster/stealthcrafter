import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StealthCrafter",
  description: "Preparedness, made simple. Trust, made standard.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script async src="https://analytics.ahrefs.com/analytics.js" data-key="bhP8wzmn8uIzbHmQ6iNBgw"></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
