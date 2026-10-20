import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import { MotionProvider } from "@/components/motion/provider";
import { NavigationProgress } from "@/components/navigation-progress";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], weight: ["500"], variable: "--font-fraunces", display: "swap" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains-mono", display: "swap" });

const DESCRIPTION = "Give to disaster relief with PayPal. PayPal holds your money - it does not take it. You pay only for what the charity proves it delivered.";

export const metadata: Metadata = {
  // Link previews need absolute image URLs: the site's own address (127.0.0.1 in development).
  metadataBase: new URL(process.env.AUTH_URL ?? "http://127.0.0.1:3000"),
  title: { default: "Proven - only charged when delivery is proven", template: "%s - Proven" },
  description: DESCRIPTION,
  applicationName: "Proven",
  openGraph: {
    type: "website",
    siteName: "Proven",
    locale: "en_US",
    title: "Proven - only charged when delivery is proven",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "Proven - only charged when delivery is proven", description: DESCRIPTION },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${mono.variable}`}>
      <body className="antialiased">
        <MotionProvider>
          <Suspense fallback={null}>
            <NavigationProgress />
          </Suspense>
          {children}
        </MotionProvider>
      </body>
    </html>
  );
}
