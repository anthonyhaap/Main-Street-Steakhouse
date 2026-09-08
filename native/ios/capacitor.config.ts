import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The iPhone app is the website in a frame.
 *
 * Nothing is bundled. `server.url` points the web view at the live site, so a
 * deploy to Vercel is a deploy to every phone with no TestFlight build in
 * between, and the app can never be a stale copy of a league that moves every
 * Sunday. `www/` exists because Capacitor insists on one; it holds a single
 * page that is only ever seen with no signal.
 *
 * What the frame adds that Safari cannot: an icon in the App Store sense,
 * notifications through Apple's push service (Web Push does not reach a web
 * view), and league links that open here rather than in Safari.
 */
const config: CapacitorConfig = {
  appId: "football.steakhouse.app",
  appName: "Steakhouse",
  webDir: "www",
  backgroundColor: "#191614",
  server: {
    url: "https://steakhouse.football",
    // Only the league itself stays in the frame. Anything else a manager taps
    // — a highlight, a stat page — opens in Safari, where the back button
    // means what he expects.
    allowNavigation: ["steakhouse.football"],
    errorPath: "index.html",
  },
  ios: {
    // The site already lays itself out under the status bar with
    // viewport-fit=cover, exactly as it does on the home screen.
    contentInset: "never",
    scrollEnabled: true,
    backgroundColor: "#191614",
  },
  plugins: {
    PushNotifications: {
      // A trade offer arriving while the app is open is still worth a banner.
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
