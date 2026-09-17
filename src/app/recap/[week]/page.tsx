import type { Metadata } from "next";
import { RecapScreen } from "@/components/recap/RecapScreen";

export const metadata: Metadata = { title: "The Weekly Special" };

/** One week's Special, by the number in the push. Junk falls back to the latest. */
export default async function RecapWeekPage({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const n = Number(week);
  return <RecapScreen week={Number.isInteger(n) && n > 0 && n < 30 ? n : null} />;
}
