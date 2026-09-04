"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ChevronRight, Shield, Sparkles, Users, X } from "lucide-react";
import { useSession } from "@/lib/session";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CREST_BUCKET, CREST_TYPES, crestUpload, crestUrl } from "@/lib/crest";
import { Seal, SkeletonRows, useToast } from "@/components/ui";
import { TopBar } from "@/components/Shell";

type BadgeMode = "initials" | "photo";

function initialsFor(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "MS";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words.at(-1)![0]).toUpperCase();
}

async function initialsBadge(initials: string): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not make your badge.");
  ctx.fillStyle = "#6a0b20";
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "#c99c3f";
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.arc(256, 256, 210, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#fdf7ee";
  ctx.font = "700 178px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials, 256, 270);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This browser could not make your badge.");
  return new File([blob], "team-initials.png", { type: "image/png" });
}

export default function WelcomePage() {
  const router = useRouter();
  const toast = useToast();
  const { team, ready, reload } = useSession();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [mode, setMode] = useState<BadgeMode>("initials");
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!team || name) return;
    setName(team.name);
    setInitials(initialsFor(team.name));
  }, [name, team]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  const first = (team?.manager_name || "Manager").trim().split(/\s+/)[0];
  const preview = mode === "photo" ? photo?.preview ?? crestUrl(team?.logo_path) : null;
  const badgeName = mode === "initials" ? initials : name;
  const valid = name.trim().length >= 2 && name.trim().length <= 40 && /^[A-Za-z0-9]{1,3}$/.test(initials);

  async function save() {
    if (!team || !valid) return;
    setBusy(true);
    const supabase = supabaseBrowser();
    let uploaded: string | null = null;
    try {
      const file = mode === "initials" ? await initialsBadge(initials) : photo?.file;
      if (file) {
        const { blob, ext } = await crestUpload(file);
        uploaded = `${team.id}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from(CREST_BUCKET).upload(uploaded, blob, {
          contentType: blob.type, upsert: false,
        });
        if (error) throw new Error(error.message);
      }
      const { error } = await supabase.rpc("ff_update_my_team", {
        p_name: name.trim(),
        p_logo_path: uploaded,
      });
      if (error) throw new Error(error.message);
      if (team.logo_path && uploaded) await supabase.storage.from(CREST_BUCKET).remove([team.logo_path]);
      await reload();
      setStep(2);
    } catch (error) {
      if (uploaded) await supabase.storage.from(CREST_BUCKET).remove([uploaded]).catch(() => {});
      toast("error", error instanceof Error ? error.message : "Couldn't save your team.");
    } finally {
      setBusy(false);
    }
  }

  const progress = useMemo(() => ["Welcome", "Your team", "Quick tour"], []);

  if (!ready || !team) return <><TopBar /><main className="page" data-width="narrow"><div className="card"><SkeletonRows n={5} /></div></main></>;

  return (
    <>
      <TopBar />
      <main className="page" data-width="narrow">
        <div style={{ display: "flex", gap: 8, marginBottom: "var(--s4)" }} aria-label={`Step ${step + 1} of 3`}>
          {progress.map((label, index) => <div key={label} style={{ flex: 1 }}>
            <div style={{ height: 3, borderRadius: 9, background: index <= step ? "var(--gold)" : "var(--rule)" }} />
            <span className="eyebrow" style={{ display: "block", marginTop: 6, color: index === step ? "var(--wine)" : "var(--dim)" }}>{label}</span>
          </div>)}
        </div>

        {step === 0 && <section className="card">
          <div className="card__body" style={{ padding: "clamp(28px, 7vw, 58px)", textAlign: "center" }}>
            <Seal name={team.name} src={crestUrl(team.logo_path)} mine size={88} />
            <div className="eyebrow" style={{ color: "var(--gold)", marginTop: 24 }}>Your table is ready</div>
            <h1 className="display" style={{ margin: "8px 0", fontSize: "clamp(2rem, 7vw, 3.5rem)" }}>Welcome, {first}.</h1>
            <p className="prose" style={{ maxWidth: 520, margin: "0 auto 26px" }}>You&apos;re officially in the Main Street Steakhouse league. First, make this team yours.</p>
            <button className="btn" data-v="primary" onClick={() => setStep(1)}>Set up my team <ChevronRight size={15} /></button>
          </div>
        </section>}

        {step === 1 && <section className="card">
          <div className="card__head"><div><div className="eyebrow" style={{ color: "var(--gold)" }}>Make it yours</div><h1 style={{ margin: "5px 0 0", fontFamily: "var(--serif)" }}>Name and badge</h1></div><Seal name={badgeName || name} src={preview} mine size={64} /></div>
          <div className="card__body" style={{ display: "grid", gap: "var(--s5)" }}>
            <div><label className="eyebrow" htmlFor="welcome-name">Team name</label><input id="welcome-name" className="field" value={name} maxLength={40} onChange={(e) => { setName(e.target.value); if (initials === initialsFor(name)) setInitials(initialsFor(e.target.value)); }} style={{ marginTop: 7 }} /></div>
            <div>
              <span className="eyebrow">Badge</span>
              <div className="segmented" style={{ marginTop: 7 }}>
                <button className="segmented__opt" data-on={mode === "initials"} onClick={() => setMode("initials")}><Sparkles size={14} /> Initials</button>
                <button className="segmented__opt" data-on={mode === "photo"} onClick={() => setMode("photo")}><Camera size={14} /> Picture</button>
              </div>
            </div>
            {mode === "initials" ? <div><label className="eyebrow" htmlFor="welcome-initials">Your initials</label><input id="welcome-initials" className="field" value={initials} maxLength={3} onChange={(e) => setInitials(e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())} style={{ marginTop: 7, maxWidth: 150, textTransform: "uppercase" }} /><p style={{ color: "var(--dim)", fontSize: "var(--t-small)", marginBottom: 0 }}>One to three letters. We&apos;ll turn them into your league badge.</p></div> : <div>
              <input ref={input} type="file" accept={CREST_TYPES.join(",")} hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) { setPhoto({ file, preview: URL.createObjectURL(file) }); } e.target.value = ""; }} />
              <button className="btn" onClick={() => input.current?.click()}><Camera size={15} /> {photo ? "Choose another picture" : "Choose a picture"}</button>
              {photo && <button className="btn" data-v="ghost" onClick={() => setPhoto(null)} style={{ marginLeft: 8 }}><X size={14} /> Remove</button>}
              <p style={{ color: "var(--dim)", fontSize: "var(--t-small)", marginBottom: 0 }}>Square images work best. Large photos are resized before upload.</p>
            </div>}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><button className="btn" data-v="ghost" onClick={() => setStep(0)}>Back</button><button className="btn" data-v="primary" disabled={!valid || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save and continue"} <ChevronRight size={15} /></button></div>
          </div>
        </section>}

        {step === 2 && <section className="card">
          <div className="card__body" style={{ padding: "clamp(26px, 6vw, 48px)" }}>
            <div className="eyebrow" style={{ color: "var(--gold)" }}>The house in 30 seconds</div>
            <h1 className="display" style={{ margin: "8px 0 22px" }}>You&apos;re ready.</h1>
            <div style={{ display: "grid", gap: 14 }}>
              {[{ Icon: Users, title: "Tonight is home", copy: "Your matchup, the league pulse, and the one thing worth doing next." }, { Icon: Shield, title: "My Team is yours", copy: "Set lineups, follow players, and change your team identity whenever you like." }, { Icon: Check, title: "Draft together", copy: "The live draft board, player pool, queue, and practice mocks all live under Draft." }].map(({ Icon, title, copy }) => <div key={title} style={{ display: "flex", gap: 14, padding: 16, border: "1px solid var(--rule)", borderRadius: "var(--r-md)" }}><span className="icon-box"><Icon size={17} /></span><div><strong>{title}</strong><p style={{ margin: "4px 0 0", color: "var(--muted)", lineHeight: 1.55 }}>{copy}</p></div></div>)}
            </div>
            <button className="btn" data-v="primary" style={{ width: "100%", marginTop: 24, minHeight: 48 }} onClick={() => router.replace("/")}>Take me to my table <ChevronRight size={15} /></button>
          </div>
        </section>}
      </main>
    </>
  );
}

