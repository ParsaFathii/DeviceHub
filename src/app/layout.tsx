import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeviceHub — IoT Device Management, Edge Gateway & Telemetry Analytics",
  description:
    "DeviceHub — IoT Device Management, Edge Gateway, Telemetry Analytics and Local AI Platform. Copyright © 2026 Parsa Fathi.",
  authors: [{ name: "Parsa Fathi" }],
  openGraph: {
    title: "DeviceHub",
    description: "IoT Device Management, Edge Gateway, Telemetry Analytics and Local AI Platform",
    siteName: "DeviceHub",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
