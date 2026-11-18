import { publishVideo } from "@/lib/uploadpost";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Reel = {
  workspace_id: string;
  video_url: string;
  caption: string | null;
  youtube_title: string | null;
  scheduled_at: string | null;
  status: "draft" | "scheduling" | "scheduled" | "posted" | "failed";
  upload_post_job_id: string | null;
};

function isFuture(value: string) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("Could not verify the current user:", userError);
    return Response.json({ error: "Unable to verify your session." }, { status: 401 });
  }
  if (!user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberError) {
    console.error("Could not load the user's workspace:", memberError);
    return Response.json({ error: "Unable to verify your workspace." }, { status: 500 });
  }
  if (!member || typeof member.workspace_id !== "string") {
    return Response.json({ error: "You are not assigned to a workspace." }, { status: 403 });
  }

  const { data: reel, error: reelError } = await supabase
    .from("reels")
    .select(
      "workspace_id, video_url, caption, youtube_title, scheduled_at, status, upload_post_job_id"
    )
    .eq("id", id)
    .eq("workspace_id", member.workspace_id)
    .maybeSingle<Reel>();
  if (reelError) {
    console.error("Could not load the reel:", reelError);
    return Response.json({ error: "Unable to load the reel." }, { status: 500 });
  }
  if (!reel) {
    return Response.json({ error: "Reel not found." }, { status: 404 });
  }
  if (
    reel.status === "scheduled" ||
    reel.status === "posted" ||
    reel.status === "scheduling"
  ) {
    return Response.json(
      { error: "This reel is already scheduled or is currently being scheduled." },
      { status: 409 }
    );
  }
  if (reel.upload_post_job_id) {
    return Response.json(
      { error: "This reel has already been scheduled with Upload-Post." },
      { status: 409 }
    );
  }

  const { data: platformRows, error: platformsError } = await supabase
    .from("reel_platforms")
    .select("id, platform")
    .eq("reel_id", id);
  if (platformsError) {
    console.error("Could not load reel platforms:", platformsError);
    return Response.json({ error: "Unable to load reel platforms." }, { status: 500 });
  }

  const caption = reel.caption?.trim();
  const platforms = (platformRows ?? []).filter(
    (row): row is { id: string; platform: string } =>
      typeof row.id === "string" && typeof row.platform === "string"
  );
  if (!caption) {
    return Response.json({ error: "Add a caption before scheduling." }, { status: 400 });
  }
  if (platforms.length === 0) {
    return Response.json({ error: "Select at least one platform before scheduling." }, { status: 400 });
  }
  const hasYouTube = platforms.some((platform) => platform.platform === "youtube_shorts");
  const youtubeTitle = reel.youtube_title?.trim() ?? "";
  if (hasYouTube && youtubeTitle.length > 100) {
    return Response.json(
      { error: "YouTube title must be 100 characters or fewer." },
      { status: 400 }
    );
  }
  if (!reel.scheduled_at || !isFuture(reel.scheduled_at)) {
    return Response.json({ error: "Choose a future schedule date and time." }, { status: 400 });
  }

  const { data: claimedReel, error: claimError } = await supabase
    .from("reels")
    .update({ status: "scheduling" })
    .eq("id", id)
    .eq("workspace_id", member.workspace_id)
    .eq("status", "draft")
    .is("upload_post_job_id", null)
    .select("id")
    .maybeSingle();
  if (claimError) {
    console.error("Could not claim reel for scheduling:", claimError);
    return Response.json(
      { error: "Unable to start scheduling this reel." },
      { status: 500 }
    );
  }
  if (!claimedReel) {
    return Response.json(
      { error: "This reel is already scheduled or is currently being scheduled." },
      { status: 409 }
    );
  }

  let result;
  try {
    result = await publishVideo({
      videoUrl: reel.video_url,
      caption,
      youtubeTitle: hasYouTube ? youtubeTitle : null,
      platforms: platforms.map((platform) => platform.platform),
      scheduledAt: new Date(reel.scheduled_at).toISOString(),
      externalId: id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to schedule the reel.";
    console.error("Upload-Post scheduling failed:", error);
    await supabase
      .from("reels")
      .update({ status: "draft", upload_post_job_id: null })
      .eq("id", id)
      .eq("workspace_id", member.workspace_id);
    await supabase
      .from("reel_platforms")
      .update({ status: "failed", error: message })
      .eq("reel_id", id);
    return Response.json({ error: message }, { status: 502 });
  }

  let reelUpdateError: { message: string } | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error } = await supabase
      .from("reels")
      .update({ status: "scheduled", upload_post_job_id: result.jobId })
      .eq("id", id)
      .eq("workspace_id", member.workspace_id);
    if (!error) {
      reelUpdateError = null;
      break;
    }
    reelUpdateError = error;
    console.error(
      `Could not save scheduled reel state (attempt ${attempt}/3):`,
      error
    );
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }

  if (reelUpdateError) {
    return Response.json(
      {
        error:
          "Upload-Post reports that this reel WAS scheduled, but the database could not be updated. It will not be scheduled again.",
      },
      { status: 500 }
    );
  }

  const { error: platformUpdateError } = await supabase
    .from("reel_platforms")
    .update({ status: "scheduled", error: null })
    .eq("reel_id", id);
  if (platformUpdateError) {
    console.error("Could not save platform scheduled state:", platformUpdateError);
    return Response.json({
      jobId: result.jobId,
      warning: "The reel was scheduled, but platform status could not be saved.",
    });
  }

  return Response.json({ jobId: result.jobId });
}
