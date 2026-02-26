import type { Metadata } from "next";
import { Geist, Geist_Mono, Volkhov } from "next/font/google";
import "./globals.css";
import { WalletContextProvider } from "./wallet-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const volkhov = Volkhov({
  variable: "--font-volkhov",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "PriVo - Private Voting on Solana Devnet",
  description: "Private voting dApp on Solana Devnet with Arcium. Create polls, cast encrypted votes, reveal results.",
  icons: {
    icon: "/you-_1_.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${volkhov.variable} antialiased`}
      >
        <WalletContextProvider>
          {children}
        </WalletContextProvider>
      </body>
    </html>
  );
}
