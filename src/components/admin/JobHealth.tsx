"use client";

import { useCallback } from "react";
import { Activity } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLive } from "@/lib/live";
import { LEAGUE_ID } from "@/lib/config";
import { SkeletonRows } from "@/components/ui";

/** Shape of ff_job_health(league_id). */
export type Job = {
  name: string;
  schedule: string;
  active: boolean;
  last_run: string | null;
  last_status: string | null;
  last_success: string | null;
  /** null when the job is switched off. */
  healthy: boolean | null;
};
export type JobHealthData = { available: boolean; jobs: Job[]; checked_at: string };

/**
 * The league's scheduled jobs, live, for the commissioner. Refreshes once a
 * minute; the database judges "on time" per schedule, so a weekly job is not
 * late on day two.
 */
export function JobHealth({ enabled }: { enabled: boolean }) {
  const fetcher = useCallback(async (): Promise<JobHealthData> => {
    const { data, error } = await supabaseBrowser().rpc("ff_job_health", { p_league_id: LEAGUE_ID });
    if (error) throw error;
    return data as JobHealthData;
  }, []);

  const { data, error } = useLive<JobHealthData>(fetcher, {
    tables: [],
    channel: "job-health",
    pollMs: 60000,
    enabled,
  });

  return <JobHealthCard data={data} failed={!!error && !data} />;
}

export function JobHealthCard({ data, failed = false }: { data: JobHealthData | null; failed?: boolean }) {
  const jobs = data?.available ? data.jobs : [];
  const late = jobs.filter((j) => j.healthy === false).length;
  const now = data ? new Date(data.checked_at).getTime() : 0;

  return (
    <section className="card" data-accent={late ? "wine" : undefined} aria-label="Job health">
      <div className="card__head">
        <div>
          <h2>Job health</h2>
          <div className="eyebrow" style={{ marginTop: 5 }}>The league’s scheduled jobs</div>
        </div>
        {data?.available
          ? <span className="badge" data-tone={late ? "danger" : "ok"}>{late ? `${late} late` : "On time"}</span>
          : <Activity size={17} color="var(--gold)" />}
      </div>
      {!data && !failed && <SkeletonRows n={5} />}
      {(failed || (data && !data.available)) && <div className="empty">Job status unavailable.</div>}
      {data?.available && (
        <div className="jobs">
          {jobs.length === 0 && <div className="empty">No scheduled jobs.</div>}
          {jobs.map((j) => (
            <div className="job" key={j.name} data-ok={j.healthy === null ? "off" : j.healthy}
              title={j.last_status && j.last_status !== "succeeded" ? `Last run ${j.last_status}` : undefined}>
              <i className="job__dot" />
              <span className="job__name">{j.name}</span>
              <span className="job__meta">
                {cronWords(j.schedule)} · {j.active ? ago(j.last_run, now) : "off"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** "12m ago", counted from the database's clock so the browser's cannot skew it. */
function ago(iso: string | null, now: number): string {
  if (!iso) return "no recent run";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ago`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A cron schedule in words: "every 5 min", "daily 09:00 UTC", "4× daily", "Sun 15:00 UTC". */
function cronWords(schedule: string): string {
  const s = schedule.trim();
  const secs = s.match(/^(\d+)\s*seconds?$/i);
  if (secs) return `every ${secs[1]}s`;
  const parts = s.split(/\s+/);
  if (parts.length !== 5) return s;
  const [min, hour, dom, , dow] = parts;
  const everyMin = min.match(/^\*\/(\d+)$/);
  if (everyMin && hour === "*") return `every ${everyMin[1]} min`;
  if (min === "*" && hour === "*") return "every minute";
  if (/^\d+$/.test(min) && hour === "*") return "hourly";
  if (/^\d+$/.test(min) && /^[\d,]+$/.test(hour)) {
    const hours = hour.split(",");
    const at = `${hours[0].padStart(2, "0")}:${min.padStart(2, "0")}`;
    if (/^\d$/.test(dow) && hours.length === 1) return `${DAYS[Number(dow) % 7]} ${at} UTC`;
    if (dom === "*" && dow === "*") return hours.length > 1 ? `${hours.length}× daily` : `daily ${at} UTC`;
  }
  return s;
}
