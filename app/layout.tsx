import type { Metadata } from "next";
import { Space_Grotesk, Source_Serif_4 } from "next/font/google";
import { IconColorProvider } from "@/components/ui/icon-color-provider";
import { ThemeProvider } from "@/components/ui/theme-provider";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BoringCourse",
  description: "AI school helper for assignments, study plans, and tutoring.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${sourceSerif.variable} antialiased`}>
        <ThemeProvider />
        <IconColorProvider />
        {children}
      </body>
    </html>
  );
}
