import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-indigo-600">Reels Dashboard</p>
        <h1 className="mt-2 text-3xl font-semibold text-zinc-950">
          Manage your podcast reels
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-zinc-600">
          Sign in to upload, caption, schedule, and publish your reels.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
            href="/login"
          >
            Log in
          </Link>
          <Link
            className="rounded-lg border border-zinc-300 px-5 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50"
            href="/signup"
          >
            Sign up
          </Link>
        </div>
      </div>
    </main>
  );
}
