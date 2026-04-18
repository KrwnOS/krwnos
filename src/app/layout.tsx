import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KrwnOS — Community Operating System",
  description:
    "Модульная операционная система для создания цифровых государств, компаний и сообществ.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
