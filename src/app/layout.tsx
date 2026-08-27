import type { Metadata, Viewport } from "next";
import { SessionProvider } from "@/lib/session";
import { ToastHost } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "Main Street Steakhouse League",
  description: "Private 12-manager fantasy football — live draft, live scoring.",
};

export const viewport: Viewport = {
  themeColor: "#0a0908",
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
