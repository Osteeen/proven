import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import { MotionProvider } from "@/components/motion/provider";
import { NavigationProgress } from "@/components/navigation-progress";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], weight: ["500"], variable: "--font-fraunces", display: "swap" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Proven",
  description: "Give to disaster relief. You are only charged when delivery is proven.",
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
