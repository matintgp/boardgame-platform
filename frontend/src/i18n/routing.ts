import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fa", "en"],
  defaultLocale: "fa",
  // "always": explicit /fa/... /en/... URLs. With "as-needed", a user browsing
  // /en/ pages who opens a /fa/ link gets silently redirected back to /en/
  // via the NEXT_LOCALE cookie - the explicit locale choice is lost.
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
