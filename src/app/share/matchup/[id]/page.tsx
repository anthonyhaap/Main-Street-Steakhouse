import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { shareCard, shareTitle } from "@/lib/share";
import { ShareCardView } from "@/components/ShareCardView";

/**
 * The card that lands in the group chat.
 *
 * Public on purpose, keyed by an id nobody can guess, and it says only what
 * a card should: two names, two numbers, the week, and the one player who
 * decided it. Tapping through goes to the league, where the door is locked.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = await shareCard(id);
  if (!c) return { title: "Main Street Steakhouse" };
  const title = shareTitle(c);
  const description = c.top
    ? `Tonight's Specials: ${c.top.full_name}, ${Number(c.top.points).toFixed(1)} points.`
    : `${c.league} · ${c.season}`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article", siteName: "Main Street Steakhouse" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await shareCard(id);
  if (!c) notFound();
  return <ShareCardView c={c} />;
}
