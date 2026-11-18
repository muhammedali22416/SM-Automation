import { DashboardNav } from "@/app/ui/dashboard-nav";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CalendarRefresh } from "./calendar-refresh";

type CalendarReel = {
  id: string;
  caption: string;
  status: string;
  scheduledAt: string;
  platforms: string[];
};

export const instant = false;

async function getScheduledReels(): Promise<CalendarReel[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reels")
    .select("id, caption, status, scheduled_at")
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true });
  if (error) {
    throw new Error(`Unable to load the calendar: ${error.message}`);
  }

  const result: CalendarReel[] = [];
  for (const row of data ?? []) {
    if (
      typeof row.id !== "string" ||
      typeof row.caption !== "string" ||
      typeof row.status !== "string" ||
      typeof row.scheduled_at !== "string"
    ) {
      continue;
    }
    const { data: platforms, error: platformsError } = await supabase
      .from("reel_platforms")
      .select("platform")
      .eq("reel_id", row.id);
    if (platformsError) {
      throw new Error(`Unable to load calendar platforms: ${platformsError.message}`);
    }
    result.push({
      id: row.id,
      caption: row.caption,
      status: row.status,
      scheduledAt: row.scheduled_at,
      platforms: (platforms ?? [])
        .map((platform) => platform.platform)
        .filter((platform): platform is string => typeof platform === "string"),
    });
  }
  return result;
}

export default async function CalendarPage() {
  const reels = await getScheduledReels();
  return (
    <div className="min-h-screen bg-zinc-50">
      <DashboardNav />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-indigo-600">Publishing</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">Calendar</h1>
            <p className="mt-2 text-zinc-600">Scheduled reels and their publishing status.</p>
          </div>
          <CalendarRefresh />
        </div>
        <div className="mt-8 space-y-4">
          {reels.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-zinc-600">
              No scheduled reels yet.
            </div>
          ) : (
            reels.map((reel) => (
              <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm" key={reel.id}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-medium text-zinc-950">{reel.caption}</p>
                  <span className="w-fit rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold capitalize text-zinc-700">
                    {reel.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-zinc-600">
                  {new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "short" }).format(
                    new Date(reel.scheduledAt)
                  )}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Platforms: {reel.platforms.join(", ") || "None selected"}
                </p>
              </article>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
