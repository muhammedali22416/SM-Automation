import { logout } from "@/app/actions/auth";

export default function LogoutPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-950">Log out</h1>
        <p className="mt-2 text-sm text-zinc-600">
          End your current dashboard session.
        </p>
        <form action={logout} className="mt-6">
          <button
            className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-700"
            type="submit"
          >
            Log out
          </button>
        </form>
      </div>
    </main>
  );
}
