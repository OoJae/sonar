import type { Metadata } from "next";
import { Inter, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// The display face. The fund's voice is a research note, so headlines are set
// in a serif (mostly italic) over the instrument surfaces. Used with restraint;
// see docs/brand.md.
const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
});

const SITE_TITLE = "Sonar: ETF-Flow-Aware Agentic Hedge Fund";
const SITE_DESCRIPTION =
  "An AI agent that ingests SoSoValue ETF flows and structured news, publishes dated, cited theses, rebalances SSI indices, and hedges live on SoDEX testnet with a verifiable track record.";

export const metadata: Metadata = {
  metadataBase: new URL("https://sonar.my.id"),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "https://sonar.my.id",
    siteName: "Sonar",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
