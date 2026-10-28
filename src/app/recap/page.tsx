import type { Metadata } from "next";
import { RecapScreen } from "@/components/recap/RecapScreen";

export const metadata: Metadata = { title: "The Weekly Special" };

/** The latest Special. A push for week N lands on /recap/N instead. */
export default function RecapPage() {
  return <RecapScreen week={null} />;
}
