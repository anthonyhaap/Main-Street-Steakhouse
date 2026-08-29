import { fetchWire, WIRE_TTL } from "@/lib/nfl/espn";

/**
 * GET /api/nfl/wire — league-wide NFL news and injury reports.
 *
 * The handler itself is dynamic on purpose: if it were prerendered, a build
 * that ran while ESPN was unreachable would bake an empty wire into the deploy
 * and serve it until the next build. Running per request means the worst case
 * is one empty response, not a permanent one.
 *
 * The cost of that is paid back a layer down — `fetchWire` fetches through the
 * data cache with a five-minute lifetime, so twelve managers on twelve phones
 * are still one request upstream, and a tab-focus refetch is free.
 *
 * The body is the same either way. A dead feed is reported in `sources`, never
 * as a failed request, because the page has plenty to draw without it.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const wire = await fetchWire();
  const live = wire.sources.some((s) => s.ok);

  return Response.json(wire, {
    headers: {
      // Let a CDN and the browser share the same short window the data cache
      // uses; on a total outage, hold nothing so the next try is a real one.
      "cache-control": live
        ? `public, max-age=60, s-maxage=${WIRE_TTL}, stale-while-revalidate=${WIRE_TTL * 4}`
        : "no-store",
    },
  });
}
