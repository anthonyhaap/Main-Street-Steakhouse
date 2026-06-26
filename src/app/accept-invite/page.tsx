import Link from "next/link";
import { loadInvite } from "@/lib/actions/invites";
import { AcceptForm } from "./AcceptForm";

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token ?? "";
  const invite = await loadInvite(token);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <div className="text-4xl">🏈</div>
        <h1 className="mt-2 text-2xl font-bold">League invitation</h1>
      </div>

      {!invite.valid ? (
        <div className="card text-center">
          <p className="text-slate-700">{invite.reason}</p>
          <Link href="/login" className="btn-secondary mt-4 inline-flex">
            Go to login
          </Link>
        </div>
      ) : (
        <div className="card">
          <div className="mb-4 rounded-lg bg-turf-50 p-4 text-sm text-turf-800">
            You&apos;ve been invited to join{" "}
            <strong>{invite.leagueName}</strong> as a{" "}
            <strong>{invite.role}</strong>
            {invite.teamName ? (
              <>
                {" "}
                and manage <strong>{invite.teamName}</strong>
              </>
            ) : null}
            .
          </div>
          <AcceptForm token={token} email={invite.email!} />
        </div>
      )}
    </main>
  );
}
