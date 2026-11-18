import Link from "next/link";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/app/ui/dashboard-nav";

type ReelStatus =
  | "draft"
  | "scheduling"
  | "scheduled"
  | "posted"
  | "failed";

type Reel = {
  id: string;
  status: ReelStatus;
  caption: string | null;
  scheduled_at: string | null;
};

export const instant = false;

const statusStyles: Record<ReelStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  scheduling: "bg-blue-100 text-blue-800",
  scheduled: "bg-amber-100 text-amber-800",
  posted: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

function isReelStatus(value: unknown): value is ReelStatus {
  return (
    value === "draft" ||
    value === "scheduling" ||
    value === "scheduled" ||
    value === "posted" ||
    value === "failed"
  );
}

function parseReels(rows: unknown): Reel[] {
  if (!Array.isArray(rows)) {
    throw new Error("Unable to load reels: unexpected response.");
  }

  return rows.map((row) => {
    if (
      typeof row !== "object" ||
      row === null ||
      typeof row.id !== "string" ||
      !isReelStatus(row.status) ||
      (row.caption !== null && typeof row.caption !== "string") ||
      (row.scheduled_at !== null && typeof row.scheduled_at !== "string")
    ) {
      throw new Error("Unable to load reels: invalid reel data.");
    }

    return {
      id: row.id,
      status: row.status,
      caption: row.caption,
      scheduled_at: row.scheduled_at,
    };
  });
}

function formatScheduledTime(scheduledAt: string | null) {
  if (!scheduledAt) {
    return "Not scheduled";
  }

  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) {
    return "Invalid scheduled time";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function getReels() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reels")
    .select("id, status, caption, scheduled_at")
    .order("scheduled_at", { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(`Unable to load reels: ${error.message}`);
  }

  return parseReels(data);
}

export default async function ReelsPage() {
  await connection();
  const reels = await getReels();

  return (
    <div className="min-h-screen bg-zinc-50">
      <DashboardNav />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-indigo-600">Content</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">
              Reels
            </h1>
            <p className="mt-2 text-zinc-600">
              Manage your drafts and published podcast clips.
            </p>
          </div>
          {reels.length > 0 && (
            <Link
              className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition hover:bg-indigo-700"
              href="/reels/new"
            >
              Upload reel
            </Link>
          )}
        </div>

        {reels.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
            <h2 className="text-xl font-semibold text-zinc-950">
              No reels yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-zinc-600">
              Upload your first podcast clip to start creating and scheduling
              reels.
            </p>
            <Link
              className="mt-6 inline-flex rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition hover:bg-indigo-700"
              href="/reels/new"
            >
              Upload reel
            </Link>
          </div>
        ) : (
          <div className="mt-10 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <div className="divide-y divide-zinc-200">
              {reels.map((reel) => (
                <article
                  className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
                  key={reel.id}
                >
                  <div className="min-w-0">
                    <Link
                      className="block truncate text-base text-zinc-950 hover:text-indigo-700"
                      href={`/reels/${reel.id}`}
                    >
                      {reel.caption || "No caption yet"}
                    </Link>
                    <p className="mt-1 text-sm text-zinc-500">
                      Scheduled: {formatScheduledTime(reel.scheduled_at)}
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-3 sm:items-end">
                    <span
                      className={`w-fit rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusStyles[reel.status]}`}
                    >
                      {reel.status}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
