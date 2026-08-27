import { notFound } from "next/navigation";

/** Catch unknown locale routes so they render the branded not-found, not Next's default. */
export default function CatchAll() {
  notFound();
}
