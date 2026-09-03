import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { SessionProvider } from "@/lib/session";
import { ToastHost } from "@/components/ui";
import { CURTAIN_SCRIPT } from "@/components/Curtain";
import "./globals.css";

/**
 * Two faces, self-hosted so no request leaves for Google and nothing shifts
 * when they land. Fraunces is the menu type: an optical-size axis so the
 * headline at 44px and the eyebrow at 11px are cut differently. Inter carries
 * the numbers, with tabular figures so a live score never changes width as
 * it ticks.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["opsz"],
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/** iPhone launch screens. iOS only honours an exact pixel match per device. */
const SPLASH: [number, number, number, number, number][] = [
  // [css width, css height, dpr, px width, px height]
  [440, 956, 3, 1320, 2868],
  [430, 932, 3, 1290, 2796],
  [402, 874, 3, 1206, 2622],
  [393, 852, 3, 1179, 2556],
  [390, 844, 3, 1170, 2532],
  [375, 812, 3, 1125, 2436],
  [414, 896, 3, 1242, 2688],
  [414, 896, 2, 828, 1792],
  [375, 667, 2, 750, 1334],
];

export const metadata: Metadata = {
  metadataBase: new URL("https://steakhouse.football"),
  title: {
    default: "Main Street Steakhouse League",
    template: "%s · Main Street Steakhouse",
  },
  description: "Private 12-manager fantasy football — live draft, live scoring, no ads.",
  applicationName: "Main Street Steakhouse",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Main Street Steakhouse League",
    description: "Private 12-manager fantasy football — live draft, live scoring, no ads.",
    siteName: "Main Street Steakhouse",
    images: ["/logo-full.png"],
    type: "website",
  },
  appleWebApp: {
    capable: true,
    title: "Steakhouse",
    statusBarStyle: "black-translucent",
    startupImage: SPLASH.map(([w, h, dpr, pw, ph]) => ({
      url: `/splash/${pw}x${ph}.png`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
    })),
  },
};

export const viewport: Viewport = {
  themeColor: "#191614",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Sets data-curtain before first paint so the reveal never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: CURTAIN_SCRIPT }} />
      </head>
      <body>
        <SessionProvider>
          <ToastHost>
            <div className="shell">{children}</div>
          </ToastHost>
        </SessionProvider>
      </body>
    </html>
  );
}
