import Link from "next/link";
import { logout } from "@/app/actions/auth";

export function DashboardNav() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          className="text-lg font-semibold tracking-tight text-zinc-950"
          href="/reels"
        >
          Reels Dashboard
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          <Link className="font-medium text-indigo-600" href="/reels">
            Reels
          </Link>
          <Link
            className="text-zinc-600 transition hover:text-zinc-950"
            href="/calendar"
          >
            Calendar
          </Link>
          <form action={logout}>
            <button
              className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 transition hover:bg-zinc-50"
              type="submit"
            >
              Log out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
