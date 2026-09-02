import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import HomeHeroCtas from "@/components/HomeHeroCtas";

const GAMES = [
  {
    id: "chess",
    cover: "/heroes/chess.jpg",
    nameKey: "gameChess" as const,
    tagKey: "gameChessTag" as const,
  },
  {
    id: "mafia",
    cover: "/heroes/mafia.jpg",
    nameKey: "gameMafia" as const,
    tagKey: "gameMafiaTag" as const,
  },
  {
    id: "rokugan",
    cover: "/heroes/rokugan.jpg",
    nameKey: "gameRokugan" as const,
    tagKey: "gameRokuganTag" as const,
  },
  {
    id: "salem",
    cover: "/heroes/salem.jpg",
    nameKey: "gameSalem" as const,
    tagKey: "gameSalemTag" as const,
  },
];

export default function HomePage() {
  const t = useTranslations("app");
  const tl = useTranslations("lobby");

  return (
    <div className="flex flex-col gap-10">
      <section className="hero-panel enter px-6 py-16 text-center sm:px-14">
        <p className="kicker">{t("kicker")}</p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">
          {t("title")}
        </h1>
        <p className="muted mx-auto mt-4 max-w-xl text-lg">{t("tagline")}</p>
        <HomeHeroCtas />
      </section>

      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {GAMES.map((g, i) => (
          <Link
            key={g.id}
            href="/lobby"
            className={`card card-lift enter enter-d${i + 1} group overflow-hidden`}
          >
            <div className="game-cover aspect-[16/10]">
              <img src={g.cover} alt={tl(g.nameKey)} loading="lazy" />
              <div className="cover-shade" />
              <div className="absolute inset-x-0 bottom-0 p-4 text-start">
                <div className="text-lg font-bold">{tl(g.nameKey)}</div>
                <p className="muted mt-1 text-sm">{tl(g.tagKey)}</p>
              </div>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
