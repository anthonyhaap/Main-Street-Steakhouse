import type { Metadata, Viewport } from "next";
import { SessionProvider } from "@/lib/session";
import { ToastHost } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://steakhouse.football"),
  title: {
    default: "Main Street Steakhouse League",
    template: "%s · Main Street Steakhouse",
  },
  description: "Private 12-manager fantasy football — live draft, live scoring, no ads.",
  applicationName: "Main Street Steakhouse",
  openGraph: {
    title: "Main Street Steakhouse League",
    description: "Private 12-manager fantasy football — live draft, live scoring, no ads.",
    siteName: "Main Street Steakhouse",
    images: ["/logo-full.png"],
    type: "website",
  },
  appleWebApp: { capable: true, title: "Steakhouse", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#fbf8f2",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
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
