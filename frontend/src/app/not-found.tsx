import { Vazirmatn } from "next/font/google";
import "./globals.css";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  display: "swap",
});

export default function RootNotFound() {
  return (
    <html lang="fa" dir="rtl">
      <body className={`${vazirmatn.className} min-h-screen`}>
        <main className="mx-auto max-w-md px-4 py-24 text-center">
          <p className="text-6xl font-extrabold text-[var(--accent)]">404</p>
          <h1 className="mt-4 text-2xl font-bold">این صفحه پیدا نشد</h1>
          <p className="muted mt-2">یا آدرس اشتباهه، یا این صفحه دیگه نیست.</p>
          <div className="mt-6 flex justify-center gap-3">
            <a href="/fa" className="btn btn-primary">
              خانه
            </a>
            <a href="/en" className="btn btn-ghost">
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
