import { useTranslations } from "next-intl";

const GAMES = [
  { id: "chess", icon: "♞", nameFa: "شطرنج", nameEn: "Chess" },
  { id: "mafia", icon: "🕵", nameFa: "مافیا", nameEn: "Mafia", soon: true },
  { id: "rokugan", icon: "⚔", nameFa: "نبرد برای روگان", nameEn: "Battle for Rokugan", soon: true },
];

export default function HomePage() {
  const t = useTranslations("app");

  return (
    <div>
      <section className="py-14 text-center">
        <h1 className="text-4xl font-extrabold">{t("title")}</h1>
        <p className="muted mt-3 text-lg">{t("tagline")}</p>
        <div className="mt-6 flex justify-center gap-3">
          <a href="/lobby" className="btn btn-primary">♟ {t("lobby")}</a>
          <a href="/register" className="btn btn-ghost">{t("register")}</a>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {GAMES.map((g) => (
          <div key={g.id} className={`card p-5 text-center ${g.soon ? "opacity-60" : ""}`}>
            <div className="text-4xl">{g.icon}</div>
            <div className="mt-2 font-bold">
              <span lang="fa">{g.nameFa}</span> / <span lang="en">{g.nameEn}</span>
            </div>
            {g.soon && (
              <div className="muted mt-1 text-xs uppercase tracking-wider">coming soon</div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
