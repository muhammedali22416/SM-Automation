"use client";

import {
  ChangeEvent,
  FormEvent,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type CaptionOption = {
  caption: string;
  hashtags: string[];
};

type Reel = {
  id: string;
  video_url: string;
  cover_url: string | null;
  caption: string | null;
  youtube_title: string | null;
  hashtags: string[];
  caption_options: CaptionOption[];
  scheduled_at: string | null;
  status: "draft" | "scheduling" | "scheduled" | "posted" | "failed";
  upload_post_job_id: string | null;
};

const platformLabels = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube_shorts: "YouTube Shorts",
} as const;

type Platform = keyof typeof platformLabels;
type SaveState = "idle" | "saving" | "scheduling" | "uploading" | "success";

function getFirstSentence(value: string) {
  return value.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ?? value.trim();
}

function getYoutubeTitle(value: string) {
  const sentence = getFirstSentence(value);
  if (sentence.length <= 100) {
    return sentence;
  }

  const shortened = sentence.slice(0, 100).trimEnd();
  const boundary = shortened.lastIndexOf(" ");
  return (boundary > 0 ? shortened.slice(0, boundary) : shortened).trimEnd();
}

function toLocalDateTime(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000)
    .toISOString()
    .slice(0, 16);
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ReelEditor({
  reel,
  selectedPlatforms,
}: {
  reel: Reel;
  selectedPlatforms: Platform[];
}) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [caption, setCaption] = useState(reel.caption ?? "");
  const [youtubeTitle, setYoutubeTitle] = useState(
    reel.youtube_title ?? getYoutubeTitle(reel.caption ?? "")
  );
  const [youtubeTitleEdited, setYoutubeTitleEdited] = useState(
    reel.youtube_title !== null
  );
  const [hashtags, setHashtags] = useState(reel.hashtags.join(" "));
  const [coverUrl, setCoverUrl] = useState(reel.cover_url);
  const [coverPreview, setCoverPreview] = useState(reel.cover_url);
  const [platforms, setPlatforms] = useState<Platform[]>(selectedPlatforms);
  const [scheduledAt, setScheduledAt] = useState(
    toLocalDateTime(reel.scheduled_at)
  );
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function getWorkspaceId() {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error("Your session has expired. Please log in again.");
    }

    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError) {
      throw new Error(`Unable to find your workspace: ${memberError.message}`);
    }
    if (!member || typeof member.workspace_id !== "string") {
      throw new Error("You are not assigned to a workspace.");
    }

    return member.workspace_id;
  }

  async function uploadCover(file: Blob, extension: string) {
    const workspaceId = await getWorkspaceId();
    const path = `${workspaceId}/covers/${reel.id}-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("reels")
      .upload(path, file, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Unable to upload the cover: ${uploadError.message}`);
    }

    const { data } = supabase.storage.from("reels").getPublicUrl(path);
    if (!data.publicUrl) {
      throw new Error("The cover uploaded, but its public URL could not be created.");
    }

    setCoverUrl(data.publicUrl);
    setCoverPreview(data.publicUrl);
  }

  async function handleCoverUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError(null);
    setMessage(null);
    setState("uploading");
    try {
      await uploadCover(file, file.type.split("/")[1] || "jpg");
      setMessage("Cover uploaded.");
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, "The cover upload failed."));
    } finally {
      setState("idle");
      event.target.value = "";
    }
  }

  async function handleFrameCapture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setError("Wait for the video preview to load before selecting a frame.");
      return;
    }

    setError(null);
    setMessage(null);
    setState("uploading");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setState("idle");
      setError("Your browser cannot capture a video frame.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) {
            resolve(value);
          } else {
            reject(new Error("The current video frame could not be captured."));
          }
        }, "image/jpeg", 0.9);
      });
      await uploadCover(blob, "jpg");
      setMessage("Current video frame selected as the cover.");
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, "The video frame could not be saved."));
    } finally {
      setState("idle");
    }
  }

  function togglePlatform(platform: Platform) {
    if (platforms.includes(platform)) {
      setPlatforms((current) => current.filter((value) => value !== platform));
      return;
    }
    if (platform === "youtube_shorts" && !youtubeTitleEdited) {
      setYoutubeTitle(getYoutubeTitle(caption));
    }
    setPlatforms((current) => [...current, platform]);
  }

  function isYoutubeTitleTooLong() {
    return platforms.includes("youtube_shorts") && youtubeTitle.length > 100;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state !== "idle") {
      return;
    }
    if (isYoutubeTitleTooLong()) {
      setError("YouTube title must be 100 characters or fewer.");
      return;
    }

    const trimmedCaption = caption.trim();
    if (!trimmedCaption) {
      setError("Add a caption before saving the draft.");
      return;
    }

    setError(null);
    setMessage(null);
    setState("saving");

    try {
      const workspaceId = await getWorkspaceId();
      const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
      if (scheduledDate && Number.isNaN(scheduledDate.getTime())) {
        throw new Error("Choose a valid date and time.");
      }

      const { error: reelError } = await supabase
        .from("reels")
        .update({
          caption: trimmedCaption,
          youtube_title: platforms.includes("youtube_shorts")
            ? youtubeTitle.trim() || null
            : null,
          hashtags: hashtags
            .split(/\s+/)
            .map((hashtag) => hashtag.trim())
            .filter(Boolean),
          cover_url: coverUrl,
          scheduled_at: scheduledDate?.toISOString() ?? null,
          status: "draft",
        })
        .eq("id", reel.id)
        .eq("workspace_id", workspaceId);

      if (reelError) {
        throw new Error(`Unable to save the reel: ${reelError.message}`);
      }

      const { error: deleteError } = await supabase
        .from("reel_platforms")
        .delete()
        .eq("reel_id", reel.id);
      if (deleteError) {
        throw new Error(`Unable to save platforms: ${deleteError.message}`);
      }

      if (platforms.length > 0) {
        const { error: platformError } = await supabase
          .from("reel_platforms")
          .insert(
            platforms.map((platform) => ({
              reel_id: reel.id,
              platform,
            }))
          );
        if (platformError) {
          throw new Error(`Unable to save platforms: ${platformError.message}`);
        }
      }

      setMessage("Draft saved.");
      router.refresh();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, "Unable to save the draft."));
    } finally {
      setState("idle");
    }
  }

  async function handleSchedule() {
    if (state !== "idle") {
      return;
    }
    if (
      reel.status === "scheduled" ||
      reel.status === "posted" ||
      reel.status === "scheduling" ||
      reel.upload_post_job_id
    ) {
      setError(
        "This reel is already scheduled or is currently being scheduled."
      );
      return;
    }
    if (isYoutubeTitleTooLong()) {
      setError("YouTube title must be 100 characters or fewer.");
      return;
    }

    const trimmedCaption = caption.trim();
    const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
    if (!trimmedCaption) {
      setError("Add a caption before scheduling.");
      return;
    }
    if (platforms.length === 0) {
      setError("Select at least one platform before scheduling.");
      return;
    }
    if (!scheduledDate || Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      setError("Choose a future date and time before scheduling.");
      return;
    }

    setError(null);
    setMessage(null);
    setState("scheduling");
    try {
      const workspaceId = await getWorkspaceId();
      const { error: reelError } = await supabase
        .from("reels")
        .update({
          caption: trimmedCaption,
          youtube_title: platforms.includes("youtube_shorts")
            ? youtubeTitle.trim() || null
            : null,
          hashtags: hashtags.split(/\s+/).map((hashtag) => hashtag.trim()).filter(Boolean),
          cover_url: coverUrl,
          scheduled_at: scheduledDate.toISOString(),
        })
        .eq("id", reel.id)
        .eq("workspace_id", workspaceId);
      if (reelError) {
        throw new Error(`Unable to save the reel: ${reelError.message}`);
      }

      const { error: deleteError } = await supabase
        .from("reel_platforms")
        .delete()
        .eq("reel_id", reel.id);
      if (deleteError) {
        throw new Error(`Unable to save platforms: ${deleteError.message}`);
      }
      const { error: platformError } = await supabase
        .from("reel_platforms")
        .insert(
          platforms.map((platform) => ({
            reel_id: reel.id,
            platform,
          }))
        );
      if (platformError) {
        throw new Error(`Unable to save platforms: ${platformError.message}`);
      }

      const response = await fetch(`/api/reels/${reel.id}/schedule`, { method: "POST" });
      const body = (await response.json()) as { error?: string; warning?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to schedule the reel.");
      }
      setState("success");
      setMessage(body.warning ?? "Reel scheduled.");
      router.refresh();
    } catch (caughtError) {
      setState("idle");
      setError(getErrorMessage(caughtError, "Unable to schedule the reel."));
    }
  }

  return (
    <form className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]" onSubmit={handleSubmit}>
      <div className="space-y-6">
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Video preview</h2>
          <video
            className="mt-4 aspect-video w-full rounded-xl bg-zinc-950 object-contain"
            controls
            crossOrigin="anonymous"
            ref={videoRef}
            src={reel.video_url}
          />
          <canvas className="hidden" ref={canvasRef} />
          <button
            className="mt-4 rounded-lg border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={state !== "idle"}
            onClick={handleFrameCapture}
            type="button"
          >
            Use current frame as cover
          </button>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">AI caption options</h2>
          {reel.caption_options.length > 0 ? (
            <div className="mt-4 space-y-3">
              {reel.caption_options.map((option, index) => (
                <button
                  className="block w-full rounded-xl border border-zinc-200 p-4 text-left transition hover:border-indigo-400 hover:bg-indigo-50"
                  key={`${reel.id}-${index}`}
                  onClick={() => {
                    setCaption(option.caption);
                    if (!youtubeTitleEdited) {
                      setYoutubeTitle(getYoutubeTitle(option.caption));
                    }
                    setHashtags(option.hashtags.join(" "));
                  }}
                  type="button"
                >
                  <span className="text-sm font-medium text-zinc-950">
                    Option {index + 1}
                  </span>
                  <span className="mt-1 block text-sm text-zinc-700">
                    {option.caption}
                  </span>
                  <span className="mt-2 block text-sm text-indigo-700">
                    {option.hashtags.join(" ")}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">
              AI caption options are not available for this reel yet.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Caption</h2>
          <label className="mt-4 block text-sm font-medium text-zinc-700" htmlFor="caption">
            Caption text
          </label>
          <textarea
            className="mt-2 min-h-32 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            id="caption"
            onChange={(event) => {
              const value = event.target.value;
              setCaption(value);
              if (!youtubeTitleEdited) {
                setYoutubeTitle(getYoutubeTitle(value));
              }
            }}
            value={caption}
          />
          <label className="mt-4 block text-sm font-medium text-zinc-700" htmlFor="hashtags">
            Hashtags
          </label>
          <input
            className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            id="hashtags"
            onChange={(event) => setHashtags(event.target.value)}
            placeholder="#podcast #reels"
            value={hashtags}
          />
        </section>
      </div>

      <div className="space-y-6">
        {platforms.includes("youtube_shorts") && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <label className="block text-lg font-semibold text-zinc-950" htmlFor="youtube-title">
              YouTube title
            </label>
            <input
              className={`mt-4 w-full rounded-lg border px-3 py-2.5 text-sm text-zinc-900 outline-none focus:ring-2 ${
                youtubeTitle.length > 100
                  ? "border-red-300 focus:border-red-500 focus:ring-red-100"
                  : "border-zinc-300 focus:border-indigo-500 focus:ring-indigo-100"
              }`}
              id="youtube-title"
              onChange={(event) => {
                setYoutubeTitleEdited(true);
                setYoutubeTitle(event.target.value);
              }}
              value={youtubeTitle}
            />
            <p
              className={`mt-2 text-right text-xs ${
                youtubeTitle.length > 100 ? "text-red-600" : "text-zinc-500"
              }`}
            >
              {youtubeTitle.length}/100
            </p>
          </section>
        )}

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Cover image</h2>
          {coverPreview ? (
            <img
              alt="Selected reel cover"
              className="mt-4 aspect-video w-full rounded-xl object-cover"
              src={coverPreview}
            />
          ) : (
            <div className="mt-4 flex aspect-video items-center justify-center rounded-xl bg-zinc-100 text-sm text-zinc-500">
              No cover selected
            </div>
          )}
          <label className="mt-4 block text-sm font-medium text-zinc-700" htmlFor="cover">
            Upload an image
          </label>
          <input
            accept="image/*"
            className="mt-2 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-medium file:text-indigo-700"
            disabled={state !== "idle"}
            id="cover"
            onChange={handleCoverUpload}
            type="file"
          />
          <p className="mt-2 text-xs text-zinc-500">
            Video frames and uploads are stored in the reels bucket under your workspace.
          </p>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Platforms</h2>
          <div className="mt-4 space-y-3">
            {(Object.keys(platformLabels) as Platform[]).map((platform) => (
              <label className="flex items-center gap-3 text-sm text-zinc-700" key={platform}>
                <input
                  checked={platforms.includes(platform)}
                  className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                  onChange={() => togglePlatform(platform)}
                  type="checkbox"
                />
                {platformLabels[platform]}
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <label className="block text-lg font-semibold text-zinc-950" htmlFor="scheduled-at">
            Schedule date and time
          </label>
          <input
            className="mt-4 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            id="scheduled-at"
            onChange={(event) => setScheduledAt(event.target.value)}
            type="datetime-local"
            value={scheduledAt}
          />
          <p className="mt-2 text-xs text-zinc-500">
            Save a draft or schedule it for Upload-Post to publish.
          </p>
        </section>

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700" role="status">
            {message}
          </p>
        )}
        <button
          className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state !== "idle" || isYoutubeTitleTooLong()}
          type="submit"
        >
          {state === "saving" ? "Saving draft..." : "Save as Draft"}
        </button>
        <button
          className="w-full rounded-lg border border-indigo-200 px-4 py-3 font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={
            state !== "idle" ||
            isYoutubeTitleTooLong() ||
            reel.status === "scheduled" ||
            reel.status === "posted" ||
            reel.status === "scheduling" ||
            Boolean(reel.upload_post_job_id)
          }
          onClick={handleSchedule}
          type="button"
        >
          {state === "scheduling" ? "Scheduling..." : "Schedule"}
        </button>
      </div>
    </form>
  );
}
