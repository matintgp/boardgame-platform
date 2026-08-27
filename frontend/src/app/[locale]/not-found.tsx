import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-6xl font-extrabold text-[var(--accent)]">404</p>
      <h1 className="mt-4 text-2xl font-bold">{t("title")}</h1>
      <p className="muted mt-2">{t("body")}</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="btn btn-primary">
          {t("home")}
        </Link>
        <Link href="/lobby" className="btn btn-ghost">
          {t("lobby")}
        </Link>
      </div>
    </div>
  );
}
