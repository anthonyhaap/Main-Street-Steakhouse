import type { MetadataRoute } from "next";

/**
 * What makes the phone treat this as an app rather than a bookmark: a name
 * for the icon, standalone display so Safari's chrome disappears and the
 * design fills the screen, and an ink background behind the launch.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Main Street Steakhouse League",
    short_name: "Steakhouse",
    description: "Private 12-manager fantasy football — live draft, live scoring, no ads.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#191614",
    theme_color: "#191614",
    categories: ["sports"],
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      { name: "Live scores", url: "/matchups", description: "This week's tables" },
      { name: "My team", url: "/team", description: "Set the lineup" },
    ],
  };
}
