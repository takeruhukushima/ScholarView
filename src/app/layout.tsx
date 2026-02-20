import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScholarView",
  description: "Distributed peer review and discussion app on AT Protocol",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
