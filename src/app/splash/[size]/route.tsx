import { ImageResponse } from "next/og";

/**
 * The launch screen an installed app shows while it wakes: ink, a soft
 * vignette, and the crest etched in gold. iOS only honours a startup image
 * whose pixel size matches the device exactly, so rather than ship a folder
 * of PNGs this draws whatever size the layout's <link> tags ask for —
 * `/splash/1170x2532.png` — and lets the CDN keep it.
 */
export const dynamic = "force-static";

const MAX = 3000;

export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  const m = /^(\d{3,4})x(\d{3,4})\.png$/.exec(size);
  if (!m) return new Response("Not found", { status: 404 });
  const width = Math.min(MAX, Number(m[1]));
  const height = Math.min(MAX, Number(m[2]));
  const crest = Math.round(Math.min(width, height) * 0.22);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          backgroundColor: "#191614",
          backgroundImage: "radial-gradient(circle at 50% 42%, #2a2420 0%, #191614 58%, #0f0d0b 100%)",
        }}
      >
        <svg width={crest} height={crest} viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="28.5" stroke="#c99c3f" strokeWidth="1.6" />
          <circle cx="32" cy="32" r="24.5" stroke="#c99c3f" strokeWidth="0.5" opacity="0.5" />
          <ellipse cx="32" cy="21" rx="8.5" ry="2.6" stroke="#f3ead8" strokeWidth="1.8" />
          <path d="M32 22.5V45" stroke="#f3ead8" strokeWidth="2" strokeLinecap="round" />
          <ellipse cx="32" cy="45.5" rx="13" ry="3.4" stroke="#f3ead8" strokeWidth="1.8" />
        </svg>
      </div>
    ),
    {
      width, height,
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
  );
}
