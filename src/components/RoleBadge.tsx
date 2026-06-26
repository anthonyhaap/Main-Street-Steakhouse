import type { MemberRole } from "@/lib/types";

const styles: Record<MemberRole, string> = {
  commissioner: "bg-amber-100 text-amber-800",
  owner: "bg-turf-100 text-turf-700",
  viewer: "bg-slate-100 text-slate-600",
};

export function RoleBadge({ role }: { role: MemberRole }) {
  return <span className={`badge ${styles[role]}`}>{role}</span>;
}
