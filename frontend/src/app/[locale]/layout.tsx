import type { Metadata, Viewport } from "next";
import { Vazirmatn } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { hasLocale } from "use-intl";
import { routing } from "@/i18n/routing";
import Navbar from "@/components/Navbar";
import "../globals.css";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  display: "swap",
  variable: "--font-vazirmatn",
  fallback: ["Segoe UI", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "BoardGame Platform",
  description: "Play classic board games online",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const dir = locale === "fa" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body className={`${vazirmatn.className} ${vazirmatn.variable} min-h-screen`}>
        <NextIntlClientProvider>
          <Navbar />
          <main className="salon-main relative z-10">{children}</main>
          {process.env.NODE_ENV === "production" && (
            <script dangerouslySetInnerHTML={{ __html:
              `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}` }} />
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
