import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider"

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "A searchable, categorized directory of OSINT tools with usage guidance, tags and cautions for responsible verification.";

export const metadata: Metadata = {
  title: {
    default: "OSINT Resources",
    template: "%s | OSINT Resources",
  },
  description,
  openGraph: {
    type: "website",
    siteName: "OSINT Resources",
    title: "OSINT Resources",
    description,
  },
  twitter: {
    card: "summary",
    title: "OSINT Resources",
    description,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
