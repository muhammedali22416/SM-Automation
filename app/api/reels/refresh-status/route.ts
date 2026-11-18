import { getUploadPostStatus } from "@/lib/uploadpost";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return Response.json({ error: "You must be logged in." }, { status: 401 });
  }

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberError || !member?.workspace_id) {
    return Response.json({ error: "Unable to verify your workspace." }, { status: 403 });
  }

  const { data: reels, error: reelsError } = await supabase
    .from("reels")
    .select("id, upload_post_job_id")
    .eq("workspace_id", member.workspace_id)
    .eq("status", "scheduled");
  if (reelsError) {
    return Response.json({ error: "Unable to load scheduled reels." }, { status: 500 });
  }

  for (const reel of reels ?? []) {
    if (typeof reel.id !== "string" || typeof reel.upload_post_job_id !== "string") {
      continue;
    }
    try {
      const uploadStatus = await getUploadPostStatus(reel.upload_post_job_id);
      const status =
        uploadStatus.status === "completed"
          ? "posted"
          : uploadStatus.status === "failed"
            ? "failed"
            : "scheduled";
      if (status === "scheduled") {
        continue;
      }

      await supabase
        .from("reels")
        .update({ status })
        .eq("id", reel.id)
        .eq("workspace_id", member.workspace_id);
      for (const result of uploadStatus.results) {
        const platform =
          result.platform === "youtube" ? ["youtube", "youtube_shorts"] : [result.platform];
        const platformStatus =
          result.status === "completed" || result.success === true ? "posted" : "failed";
        await supabase
          .from("reel_platforms")
          .update({
            status: platformStatus,
            error:
              platformStatus === "failed"
                ? result.message ?? uploadStatus.message ?? "Upload failed."
                : null,
          })
          .eq("reel_id", reel.id)
          .in("platform", platform);
      }
    } catch (error) {
      console.error(`Could not refresh reel ${reel.id}:`, error);
    }
  }

  return Response.json({ success: true });
}
