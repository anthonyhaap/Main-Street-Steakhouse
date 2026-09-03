/**
 * Fixture harness for the share card. Not linked from anywhere. The teams,
 * managers and score are invented; the player is a real one used as a row.
 */

import { ShareCardView } from "@/components/ShareCardView";

export default function SharePreview() {
  return (
    <ShareCardView
      c={{
        league: "Main Street Steakhouse", season: 2026, week: 3, final: true,
        home: { name: "Gridiron Butchers", manager: "Anthony", points: 132.4, crest: null },
        away: { name: "The Porterhouse", manager: "Dave", points: 118.9, crest: null },
        top: { full_name: "Jonathan Taylor", position: "RB", points: 31.2, team: "Gridiron Butchers" },
      }}
    />
  );
}
