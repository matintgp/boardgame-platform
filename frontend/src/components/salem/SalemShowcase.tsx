"use client";

import "@/styles/salem.css";

import { useTranslations } from "next-intl";
import SalemCard from "./SalemCard";
import SalemTableFelt from "./SalemTableFelt";

/** Visual identity mount only. Frontend can swap in the live table later. */
export default function SalemShowcase() {
  const t = useTranslations("salem");

  return (
    <section className="salem-root flex flex-col gap-6">
      <header className="text-center">
        <p className="kicker">{t("kicker")}</p>
        <h1 className="mt-1 text-3xl font-extrabold">{t("title")}</h1>
        <p className="muted mx-auto mt-2 max-w-md text-sm">{t("tagline")}</p>
      </header>

      <SalemTableFelt
        accusationCount={3}
        hourglass
        hourglassSeconds={18}
        deckLabel={t("deck")}
        discardLabel={t("discard")}
        pileLabel={t("accusations")}
      >
        <div className="flex flex-wrap items-end justify-center gap-2">
          <SalemCard face="play" color="green" flipped title={t("color.green")} compact />
          <SalemCard face="play" color="blue" flipped title={t("color.blue")} compact />
          <SalemCard face="play" color="red" flipped title={t("color.red")} compact selected />
          <SalemCard face="play" color="black" flipped title={t("color.black")} compact />
        </div>
      </SalemTableFelt>

      <div className="flex flex-wrap justify-center gap-3">
        <SalemCard face="tryal-back" />
        <SalemCard face="witch" flipped />
        <SalemCard face="not-witch" flipped />
        <SalemCard face="constable" flipped />
      </div>
    </section>
  );
}
