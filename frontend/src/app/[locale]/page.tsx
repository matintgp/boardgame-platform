import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import HomeHeroCtas from "@/components/HomeHeroCtas";

const GAMES = [
  {
    id: "chess",
    cover: "/heroes/chess.jpg",
    nameKey: "gameChess" as const,
    tagKey: "gameChessTag" as const,
    worldKey: "gameWorldChess" as const,
  },
  {
    id: "mafia",
    cover: "/heroes/mafia.jpg",
    nameKey: "gameMafia" as const,
    tagKey: "gameMafiaTag" as const,
    worldKey: "gameWorldMafia" as const,
  },
  {
    id: "rokugan",
    cover: "/heroes/rokugan.jpg",
    nameKey: "gameRokugan" as const,
    tagKey: "gameRokuganTag" as const,
    worldKey: "gameWorldRokugan" as const,
  },
  {
    id: "salem",
    cover: "/heroes/salem.jpg",
    nameKey: "gameSalem" as const,
    tagKey: "gameSalemTag" as const,
    worldKey: "gameWorldSalem" as const,
  },
];

export default function HomePage() {
  const t = useTranslations("app");
  const tl = useTranslations("lobby");

  return (
    <div className="home-stack">
      <section className="hero-panel hero-compact enter px-6 text-center sm:px-12">
        <p className="kicker">{t("kicker")}</p>
        <h1 className="type-display mt-3">{t("title")}</h1>
        <p className="muted mx-auto mt-3 max-w-xl text-base sm:text-lg">{t("tagline")}</p>
        <HomeHeroCtas />
      </section>

      <section className="home-library enter enter-d1" aria-labelledby="home-library-title">
        <div className="mb-4">
          <h2 id="home-library-title" className="salon-section-title">{t("tablesOpen")}</h2>
          <p className="salon-section-sub mt-1">{t("tablesOpenHint")}</p>
        </div>
        <div className="home-tile-grid">
          {GAMES.map((g, i) => (
            <Link
              key={g.id}
              href="/lobby"
              className={`card card-lift game-tile is-${g.id} enter enter-d${i + 1} group overflow-hidden`}
            >
              <div className="game-cover">
                <img src={g.cover} alt={tl(g.nameKey)} loading="lazy" />
                <div className="cover-shade" />
                <div className="absolute inset-x-0 bottom-0 p-4 text-start sm:p-5">
                  <p className="game-tile-kicker">{t(g.worldKey)}</p>
                  <div className="mt-1 text-lg font-bold sm:text-xl">{tl(g.nameKey)}</div>
                  <p className="muted mt-1 text-sm">{tl(g.tagKey)}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
