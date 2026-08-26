import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const GAMES = [
  { id: "chess", icon: "♞", nameKey: "gameChess" as const, tagKey: "gameChessTag" as const },
  { id: "mafia", icon: "🕵", nameKey: "gameMafia" as const, tagKey: "gameMafiaTag" as const },
  { id: "rokugan", icon: "⚔", nameKey: "gameRokugan" as const, tagKey: "gameRokuganTag" as const },
];

export default function HomePage() {
  const t = useTranslations("app");
  const tl = useTranslations("lobby");

  return (
    <div>
      <section className="py-14 text-center">
        <h1 className="text-4xl font-extrabold">{t("title")}</h1>
        <p className="muted mt-3 text-lg">{t("tagline")}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/lobby" className="btn btn-primary">
            ♟ {t("lobby")}
          </Link>
          <Link href="/register" className="btn btn-ghost">
            {t("register")}
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {GAMES.map((g) => (
          <Link
            key={g.id}
            href="/lobby"
            className="card group p-5 text-center transition-colors hover:border-[var(--accent)] hover:bg-[rgba(212,162,78,0.07)]"
          >
            <div className="text-4xl">{g.icon}</div>
            <div className="mt-2 font-bold">{tl(g.nameKey)}</div>
            <p className="muted mt-1 text-sm">{tl(g.tagKey)}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
