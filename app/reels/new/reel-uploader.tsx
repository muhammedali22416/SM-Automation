"use client";

import {
  ChangeEvent,
  FormEvent,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILE_SIZE_LABEL = "50 MB";

type CaptionOption = {
  caption: string;
  hashtags: string[];
};

type GenerationResult = {
  transcript: string;
  caption_options: CaptionOption[];
};

type UploadState =
  | "idle"
  | "uploading"
  | "transcribing"
  | "retrying"
  | "fallback"
  | "writing"
  | "ready"
  | "saving"
  | "error";

type RetryAction = "upload" | "generation" | "saving";

function getStorageUploadUrl(bucket: string, path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) {
    throw new Error("Supabase is not configured.");
  }

  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${baseUrl}/storage/v1/object/${bucket}/${encodedPath}`;
}

function uploadFile(
  url: string,
  file: File,
  accessToken: string,
  onProgress: (progress: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    request.setRequestHeader(
      "apikey",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
    );
    request.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );
    request.setRequestHeader("x-upsert", "false");

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }

      reject(new Error("The video could not be uploaded."));
    });
    request.addEventListener("error", () => {
      reject(new Error("The video upload failed. Check your connection and try again."));
    });
    request.addEventListener("abort", () => {
      reject(new Error("The video upload was cancelled."));
    });
    request.send(file);
  });
}

function parseGenerationResult(value: unknown): GenerationResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("Caption generation returned an invalid response.");
  }

  const result = value as {
    transcript?: unknown;
    caption_options?: unknown;
  };
  if (
    typeof result.transcript !== "string" ||
    !Array.isArray(result.caption_options) ||
    result.caption_options.length !== 3
  ) {
    throw new Error("Caption generation returned an invalid response.");
  }

  const captionOptions = result.caption_options.map((option) => {
    if (typeof option !== "object" || option === null) {
      throw new Error("Caption generation returned an invalid response.");
    }

    const parsedOption = option as { caption?: unknown; hashtags?: unknown };
    if (
      typeof parsedOption.caption !== "string" ||
      !Array.isArray(parsedOption.hashtags) ||
      !parsedOption.hashtags.every((hashtag) => typeof hashtag === "string")
    ) {
      throw new Error("Caption generation returned an invalid response.");
    }

    return {
      caption: parsedOption.caption,
      hashtags: parsedOption.hashtags,
    };
  });

  return {
    transcript: result.transcript,
    caption_options: captionOptions,
  };
}

export function ReelUploader() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [reelId, setReelId] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<RetryAction>("upload");
  const [generationMessage, setGenerationMessage] = useState<string | null>(
    null
  );

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    setError(null);
    setProgress(0);
    setRetryAction("upload");

    if (!selectedFile) {
      setFile(null);
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setFile(null);
      event.target.value = "";
      setError(`Choose a video smaller than ${MAX_FILE_SIZE_LABEL}.`);
      return;
    }

    setFile(selectedFile);
  }

  async function generateCaptions(id: string) {
    setError(null);
    setGenerationMessage("AI is transcribing...");
    setState("transcribing");

    const response = await fetch(`/api/reels/${id}/generate`, {
      method: "POST",
    });
    if (!response.ok) {
      const body: unknown = await response.json();
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : "Caption generation failed.";
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("Caption generation returned no response.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let generatedResult: GenerationResult | null = null;
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        const event = JSON.parse(line) as {
          type?: string;
          message?: unknown;
          data?: unknown;
        };
        if (event.type === "status" && typeof event.message === "string") {
          setGenerationMessage(event.message);
          if (event.message === "AI is busy, retrying...") {
            setState("retrying");
          } else if (event.message === "Switching to backup AI...") {
            setState("fallback");
          } else if (event.message === "AI is writing captions...") {
            setState("writing");
          } else {
            setState("transcribing");
          }
        } else if (event.type === "result") {
          generatedResult = parseGenerationResult(event.data);
        } else if (event.type === "error" && typeof event.message === "string") {
          throw new Error(event.message);
        }
      }

      if (done) {
        break;
      }
    }

    if (!generatedResult) {
      throw new Error("Caption generation returned no result.");
    }

    setResult(generatedResult);
    setSelectedIndex(null);
    setState("ready");
    setGenerationMessage(null);
  }

  async function uploadAndGenerate() {
    if (!file) {
      return;
    }

    setError(null);
    setProgress(0);
    setState("uploading");
    setRetryAction("upload");

    let storagePath: string | null = null;
    let reelCreated = false;

    try {
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

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("Your session has expired. Please log in again.");
      }

      storagePath = `${member.workspace_id}/${file.name}`;
      await uploadFile(
        getStorageUploadUrl("reels", storagePath),
        file,
        session.access_token,
        setProgress
      );
      setProgress(100);

      const { data } = supabase.storage.from("reels").getPublicUrl(storagePath);
      if (!data.publicUrl) {
        throw new Error("The video uploaded, but its public URL could not be created.");
      }

      const { data: reel, error: reelError } = await supabase
        .from("reels")
        .insert({
          workspace_id: member.workspace_id,
          video_url: data.publicUrl,
          status: "draft",
        })
        .select("id")
        .single();

      if (reelError || !reel || typeof reel.id !== "string") {
        throw new Error(
          reelError
            ? `Unable to save the reel: ${reelError.message}`
            : "Unable to save the uploaded reel."
        );
      }

      reelCreated = true;
      setReelId(reel.id);
      setRetryAction("generation");
      await generateCaptions(reel.id);
    } catch (caughtError) {
      setState("error");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong while uploading the reel."
      );

      if (reelCreated) {
        setRetryAction("generation");
      }

      if (storagePath && !reelCreated) {
        await supabase.storage.from("reels").remove([storagePath]);
      }
    }
  }

  async function handleRetry() {
    if (retryAction === "generation" && reelId) {
      try {
        await generateCaptions(reelId);
      } catch (caughtError) {
        setState("error");
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Caption generation failed."
        );
      }
      return;
    }

    if (retryAction === "saving") {
      setError(null);
      setState("ready");
      return;
    }

    setError(null);
    setProgress(0);
    setState("idle");
  }

  function updateCaption(index: number, caption: string) {
    setResult((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        caption_options: current.caption_options.map((option, optionIndex) =>
          optionIndex === index ? { ...option, caption } : option
        ),
      };
    });
  }

  async function handleNext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reelId || !result || selectedIndex === null || state !== "ready") {
      return;
    }

    const selectedOption = result.caption_options[selectedIndex];
    if (!selectedOption.caption.trim()) {
      setError("Add text to the selected caption before continuing.");
      setRetryAction("saving");
      setState("error");
      return;
    }

    setError(null);
    setState("saving");
    setRetryAction("saving");

    try {
      const { error: saveError } = await supabase
        .from("reels")
        .update({
          caption: selectedOption.caption.trim(),
          hashtags: selectedOption.hashtags,
        })
        .eq("id", reelId);

      if (saveError) {
        throw new Error(`Unable to save the caption: ${saveError.message}`);
      }

      router.push(`/reels/${reelId}`);
    } catch (caughtError) {
      setState("error");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save the selected caption."
      );
    }
  }

  const isBusy =
    state === "uploading" ||
    state === "transcribing" ||
    state === "retrying" ||
    state === "fallback" ||
    state === "writing" ||
    state === "saving";
  const showUploadForm = state === "idle" || state === "uploading";

  return (
    <form
      className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
      onSubmit={handleNext}
    >
      {showUploadForm && (
        <>
          <p className="text-sm font-medium text-indigo-600">Step 1</p>
          <h2 className="mt-1 text-xl font-semibold text-zinc-950">
            Choose a video
          </h2>
          <label className="block text-sm font-medium text-zinc-700" htmlFor="video">
            Video file
          </label>
          <input
            accept="video/*"
            className="mt-2 block w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-700 file:mr-4 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-medium file:text-indigo-700"
            disabled={isBusy}
            id="video"
            onChange={handleFileChange}
            required
            type="file"
          />
          <p className="mt-2 text-sm text-zinc-500">
            Maximum file size: {MAX_FILE_SIZE_LABEL}.
          </p>
          {file && (
            <p className="mt-4 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              Selected: {file.name}
            </p>
          )}
        </>
      )}

      {state === "uploading" && (
        <div className="mt-5" aria-live="polite">
          <p className="text-sm font-medium text-indigo-600">Step 2</p>
          <p className="mt-1 text-sm text-zinc-700">Uploading video {progress}%</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {(state === "transcribing" ||
        state === "retrying" ||
        state === "fallback" ||
        state === "writing") && (
        <div className="mt-5" aria-live="polite">
          <p className="text-sm font-medium text-zinc-700">
            {generationMessage ??
              (state === "writing"
                ? "AI is writing captions..."
                : "AI is transcribing...")}
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full w-2/5 animate-pulse rounded-full bg-indigo-600" />
          </div>
        </div>
      )}

      {state === "ready" && result && (
        <div aria-live="polite">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-indigo-600">Step 3</p>
              <h2 className="mt-1 text-xl font-semibold text-zinc-950">
                Choose a caption
              </h2>
            </div>
            <span className="text-sm text-zinc-500">3 options</span>
          </div>
          <div className="mt-5 space-y-3">
            {result.caption_options.map((option, index) => {
              const isSelected = selectedIndex === index;
              return (
                <div
                  className={`rounded-xl border p-4 transition ${
                    isSelected
                      ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100"
                      : "border-zinc-200"
                  }`}
                  key={index}
                >
                  <button
                    aria-pressed={isSelected}
                    className="flex w-full items-center gap-3 text-left"
                    onClick={() => setSelectedIndex(index)}
                    type="button"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                        isSelected
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-zinc-300"
                      }`}
                    >
                      {isSelected ? "✓" : ""}
                    </span>
                    <span className="text-sm font-medium text-zinc-950">
                      Option {index + 1}
                    </span>
                  </button>
                  <textarea
                    aria-label={`Caption option ${index + 1}`}
                    className="mt-3 min-h-24 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    onChange={(event) => updateCaption(index, event.target.value)}
                    value={option.caption}
                  />
                  <p className="mt-2 text-sm text-indigo-700">
                    {option.hashtags.join(" ")}
                  </p>
                </div>
              );
            })}
          </div>
          <button
            className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={selectedIndex === null}
            type="submit"
          >
            Next
          </button>
          <button
            className="mt-4 text-sm font-medium text-zinc-600 underline underline-offset-4 hover:text-zinc-950"
            onClick={() => setShowTranscript((current) => !current)}
            type="button"
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
          {showTranscript && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 text-sm text-zinc-700">
              {result.transcript}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-lg bg-red-50 p-3" role="alert">
          <p className="text-sm text-red-700">{error}</p>
          <button
            className="mt-3 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
            onClick={handleRetry}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {state === "idle" && (
        <button
          className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!file}
          type="button"
          onClick={uploadAndGenerate}
        >
          Upload video
        </button>
      )}
    </form>
  );
}
