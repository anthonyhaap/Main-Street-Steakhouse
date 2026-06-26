import { signOut } from "@/lib/actions/auth";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button type="submit" className="text-sm text-slate-500 hover:text-slate-800">
        Sign out
      </button>
    </form>
  );
}
