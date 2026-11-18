import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardNav } from "@/app/ui/dashboard-nav";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ReelEditor } from "./reel-editor";

type CaptionOption = {
  caption: string;
  hashtags: string[];
};

type Reel = {
  id: string;
  video_url: string;
  cover_url: string | null;
  transcript: string | null;
  caption: string | null;
  youtube_title: string | null;
  hashtags: string[];
  caption_options: CaptionOption[];
  scheduled_at: string | null;
  status: "draft" | "scheduling" | "scheduled" | "posted" | "failed";
  upload_post_job_id: string | null;
};

const platforms = [
  "instagram",
  "facebook",
  "tiktok",
  "linkedin",
  "youtube_shorts",
] as const;

export const instant = false;

function isCaptionOption(value: unknown): value is CaptionOption {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const option = value as { caption?: unknown; hashtags?: unknown };
  return (
    typeof option.caption === "string" &&
    Array.isArray(option.hashtags) &&
    option.hashtags.every((hashtag) => typeof hashtag === "string")
  );
}

function logInvalidField(field: string) {
  console.error(`Unable to parse reel field "${field}".`);
}

function normalizeCaptionOptions(value: unknown): CaptionOption[] {
  if (value === null || value === undefined) {
    return [];
  }

  let options: unknown[];
  if (Array.isArray(value)) {
    options = value;
  } else if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { options?: unknown }).options)
  ) {
    options = (value as { options: unknown[] }).options;
  } else {
    logInvalidField("caption_options");
    return [];
  }

  return options.filter((option, index): option is CaptionOption => {
    if (!isCaptionOption(option)) {
      logInvalidField(`caption_options[${index}]`);
      return false;
    }
    return true;
  });
}

function normalizeHashtags(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  if (Array.isArray(value) && value.every((hashtag) => typeof hashtag === "string")) {
    return value;
  }

  logInvalidField("hashtags");
  return [];
}

function parseReel(value: unknown): Reel {
  if (typeof value !== "object" || value === null) {
    logInvalidField("reel");
    throw new Error("Invalid reel data.");
  }

  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string") {
    logInvalidField("id");
    throw new Error("Invalid reel data.");
  }

  const optionalStringFields = [
    "video_url",
    "cover_url",
    "transcript",
    "caption",
    "youtube_title",
    "scheduled_at",
  ] as const;
  for (const field of optionalStringFields) {
    if (
      row[field] !== null &&
      row[field] !== undefined &&
      typeof row[field] !== "string"
    ) {
      logInvalidField(field);
    }
  }

  return {
    id: row.id,
    video_url: typeof row.video_url === "string" ? row.video_url : "",
    cover_url: typeof row.cover_url === "string" ? row.cover_url : null,
    transcript: typeof row.transcript === "string" ? row.transcript : null,
    caption: typeof row.caption === "string" ? row.caption : null,
    youtube_title:
      typeof row.youtube_title === "string" ? row.youtube_title : null,
    hashtags: normalizeHashtags(row.hashtags),
    caption_options: normalizeCaptionOptions(row.caption_options),
    scheduled_at: typeof row.scheduled_at === "string" ? row.scheduled_at : null,
    status:
      row.status === "draft" ||
      row.status === "scheduling" ||
      row.status === "scheduled" ||
      row.status === "posted" ||
      row.status === "failed"
        ? row.status
        : "draft",
    upload_post_job_id:
      typeof row.upload_post_job_id === "string"
        ? row.upload_post_job_id
        : null,
  };
}

async function getReel(id: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    notFound();
  }

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) {
    throw new Error(`Unable to load your workspace: ${memberError.message}`);
  }
  if (!member || typeof member.workspace_id !== "string") {
    notFound();
  }

  const { data, error } = await supabase
    .from("reels")
    .select(
      "id, video_url, cover_url, transcript, caption, youtube_title, hashtags, caption_options, scheduled_at, status, upload_post_job_id"
    )
    .eq("id", id)
    .eq("workspace_id", member.workspace_id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load reel: ${error.message}`);
  }
  if (!data) {
    notFound();
  }

  const { data: platformRows, error: platformError } = await supabase
    .from("reel_platforms")
    .select("platform")
    .eq("reel_id", id);

  if (platformError) {
    throw new Error(`Unable to load reel platforms: ${platformError.message}`);
  }

  const selectedPlatforms = (platformRows ?? [])
    .map((row) => row.platform)
    .filter(
      (platform): platform is (typeof platforms)[number] =>
        platforms.includes(platform as (typeof platforms)[number])
    );

  return {
    reel: parseReel(data),
    selectedPlatforms,
  };
}

export default async function ReelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let result: Awaited<ReturnType<typeof getReel>>;
  try {
    result = await getReel(id);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid reel data.") {
      console.error("Unable to load reel:", error);
      return (
        <div className="min-h-screen bg-zinc-50">
          <DashboardNav />
          <main className="mx-auto max-w-2xl px-6 py-16">
            <h1 className="text-2xl font-semibold text-zinc-950">
              This reel could not be loaded
            </h1>
            <p className="mt-2 text-zinc-600">
              The reel data is incomplete or invalid. Please return to your reels
              and try again.
            </p>
            <Link
              className="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
              href="/reels"
            >
              Back to reels
            </Link>
          </main>
        </div>
      );
    }
    throw error;
  }
  const { reel, selectedPlatforms } = result;

  return (
    <div className="min-h-screen bg-zinc-50">
      <DashboardNav />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div>
          <p className="text-sm font-medium text-indigo-600">Content</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">
            Edit reel
          </h1>
          <p className="mt-2 text-zinc-600">
            Choose the content, cover, platforms, and timing for this draft.
          </p>
        </div>
        <ReelEditor
          reel={reel}
          selectedPlatforms={selectedPlatforms}
        />
      </main>
    </div>
  );
}
