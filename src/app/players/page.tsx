import { redirect } from "next/navigation";

/**
 * The player pool now lives as a tab of the transaction centre.
 *
 * The route is kept rather than deleted because it is in bookmarks, in old
 * clubhouse links, and in the `next=` a sign-in carries back — all of which
 * should land on the tab they meant rather than a 404.
 */
export default function PlayersPage() {
  redirect("/transactions?tab=players");
}
