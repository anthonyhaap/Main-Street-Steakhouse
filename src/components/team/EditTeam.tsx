"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CREST_BUCKET, CREST_TYPES, crestUpload, crestUrl } from "@/lib/crest";
import { Seal, useToast } from "@/components/ui";
import type { Team } from "@/lib/types";

/**
 * The manager's own team, as he wants it: a name he chose and a picture he
 * uploaded.
 *
 * Everything here is the manager's alone. `ff_update_my_team` takes no team id
 * — it edits whatever team the caller owns — and the storage policy only lets
 * him write inside the folder named for it, so there is nothing on this screen
 * that could be pointed at somebody else's team.
 *
 * The order of operations matters, and it is: upload the file, then save the
 * key. A failed save deletes the file it just uploaded, so a rejected name
 * never leaves an orphan in the bucket, and the crest a manager can see is
 * always one the column actually points at.
 */
export function EditTeam({ team, onClose, onSaved }: {
  team: Team;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [picked, setPicked] = useState<{ file: File; preview: string } | null>(null);
  const [cleared, setCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Escape closes, the way every other overlay in the app does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // The preview is an object URL; it has to be handed back or the tab keeps the
  // whole file alive for as long as it is open. Cleanup runs on every change of
  // `picked` as well as on unmount, so replacing a pick releases the one before.
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.preview); }, [picked]);

  const trimmed = name.trim();
  const saved = crestUrl(team.logo_path);
  const shown = picked ? picked.preview : cleared ? null : saved;
  const dirty = trimmed !== team.name || !!picked || (cleared && !!team.logo_path);

  function choose(file: File | undefined) {
    if (!file) return;
    if (!CREST_TYPES.includes(file.type)) {
      toast("error", "Use a PNG, JPEG, WebP or GIF.");
      return;
    }
    setPicked({ file, preview: URL.createObjectURL(file) });
    setCleared(false);
  }

  async function save() {
    if (trimmed.length < 2) return toast("error", "A team needs a name of at least two characters.");
    if (trimmed.length > 40) return toast("error", "Team names stop at 40 characters.");

    setBusy(true);
    const supabase = supabaseBrowser();
    let uploaded: string | null = null;

    try {
      if (picked) {
        const { blob, ext } = await crestUpload(picked.file);
        // Timestamped, never overwritten: a new file is a new URL, so nobody
        // sees a stale crest out of their browser cache.
        const key = `${team.id}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage
          .from(CREST_BUCKET)
          .upload(key, blob, { contentType: blob.type, upsert: false });
        if (error) throw new Error(error.message);
        uploaded = key;
      }

      // null leaves the crest alone; "" clears it.
      const logo = uploaded ?? (cleared ? "" : null);
      const { error: rpcError } = await supabase.rpc("ff_update_my_team", {
        p_name: trimmed,
        p_logo_path: logo,
      });
      if (rpcError) throw new Error(rpcError.message);

      // The old file is nobody's now. Best effort: a crest that outlives its
      // column is litter, not a bug, and there is nothing useful to say about
      // a failed cleanup.
      if (team.logo_path && logo !== null) {
        await supabase.storage.from(CREST_BUCKET).remove([team.logo_path]);
      }

      toast("ok", "Your team is updated.");
      await onSaved();
      onClose();
    } catch (e) {
      if (uploaded) await supabase.storage.from(CREST_BUCKET).remove([uploaded]).catch(() => {});
      toast("error", e instanceof Error ? e.message : "Couldn't save your team.");
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal aria-label="Edit your team"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section className="modal__panel">
        <div className="card__head">
          <div>
            <div className="eyebrow" data-tone="gold">Your team</div>
            <h2 style={{ fontFamily: "var(--serif)", margin: "var(--s1) 0" }}>Name it, brand it</h2>
          </div>
          <button className="btn" data-v="ghost" data-size="icon" onClick={onClose}
            disabled={busy} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="card__body" style={{ display: "grid", gap: "var(--s5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--s4)", flexWrap: "wrap" }}>
            <Seal name={trimmed || team.name} src={shown} mine size={72} />

            <div style={{ display: "grid", gap: 7 }}>
              <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
                <button className="btn" data-size="sm" disabled={busy}
                  onClick={() => fileInput.current?.click()}>
                  <ImagePlus size={14} /> {shown ? "Change picture" : "Upload a picture"}
                </button>
                {shown && (
                  <button className="btn" data-v="ghost" data-size="sm" disabled={busy}
                    onClick={() => { setPicked(null); setCleared(true); }}>
                    <Trash2 size={14} /> Remove
                  </button>
                )}
              </div>
              <span style={{ fontSize: "var(--t-micro)", color: "var(--dim)", lineHeight: 1.5 }}>
                PNG, JPEG, WebP or GIF · shown as a disc
              </span>
            </div>

            <input
              ref={fileInput}
              type="file"
              accept={CREST_TYPES.join(",")}
              hidden
              onChange={(e) => {
                choose(e.target.files?.[0]);
                // Let the same file be chosen again after a Remove.
                e.target.value = "";
              }}
            />
          </div>

          <div>
            <label className="eyebrow" htmlFor="team-name" style={{ display: "block", marginBottom: 7 }}>
              Team name
            </label>
            <input
              id="team-name"
              className="field"
              value={name}
              maxLength={40}
              autoFocus
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && dirty && !busy) void save(); }}
              placeholder="Your team's name"
            />
            <div style={{ fontSize: "var(--t-micro)", color: "var(--dim)", marginTop: 7, lineHeight: 1.5 }}>
              This is the name the whole league sees — standings, scoreboard, draft board.
            </div>
          </div>

          <div style={{ display: "flex", gap: "var(--s2)", justifyContent: "flex-end" }}>
            <button className="btn" data-v="ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn" data-v="primary" onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
