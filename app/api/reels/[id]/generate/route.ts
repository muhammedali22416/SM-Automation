import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";
import Groq, { toFile } from "groq-sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const GROQ_MAX_FILE_SIZE = 25 * 1024 * 1024;
const FILE_PROCESSING_TIMEOUT_MS = 300_000;
const FILE_PROCESSING_POLL_MS = 1_000;
const OPERATION_TIMEOUT_MS = 300_000;
const GEMINI_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

type CaptionOption = {
  caption: string;
  hashtags: string[];
};

type GenerationResult = {
  transcript: string;
  caption_options: CaptionOption[];
};

type ReelRow = {
  workspace_id: string;
  video_url: string;
};

function isCaptionOption(value: unknown): value is CaptionOption {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const option = value as { caption?: unknown; hashtags?: unknown };
  return (
    typeof option.caption === "string" &&
    option.caption.trim().length > 0 &&
    Array.isArray(option.hashtags) &&
    option.hashtags.length > 0 &&
    option.hashtags.every(
      (hashtag) => typeof hashtag === "string" && hashtag.trim().length > 0
    )
  );
}

function parseGenerationResult(value: unknown): GenerationResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("Gemini returned an invalid response.");
  }

  const result = value as {
    transcript?: unknown;
    caption_options?: unknown;
  };

  if (
    typeof result.transcript !== "string" ||
    result.transcript.trim().length === 0 ||
    !Array.isArray(result.caption_options) ||
    result.caption_options.length !== 3 ||
    !result.caption_options.every(isCaptionOption)
  ) {
    throw new Error("Gemini returned an invalid transcript or caption list.");
  }

  return {
    transcript: result.transcript.trim(),
    caption_options: result.caption_options.map((option) => ({
      caption: option.caption.trim(),
      hashtags: option.hashtags.map((hashtag) => hashtag.trim()),
    })),
  };
}

function getVideoMimeType(response: Response, videoUrl: string) {
  const contentType = response.headers.get("content-type")?.split(";")[0].trim();
  if (contentType?.startsWith("video/")) {
    return contentType;
  }

  const extension = new URL(videoUrl).pathname.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
  };

  return (extension && mimeTypes[extension]) || "video/mp4";
}

async function waitForFileProcessing(
  ai: GoogleGenAI,
  fileName: string
): Promise<{ uri: string; mimeType: string }> {
  const deadline = Date.now() + FILE_PROCESSING_TIMEOUT_MS;
  let file = await withTimeout(
    ai.files.get({ name: fileName }),
    OPERATION_TIMEOUT_MS,
    "Timed out while checking the Gemini file state."
  );

  while (file.state !== "ACTIVE" && Date.now() < deadline) {
    console.log(`[Gemini] File ${fileName} state: ${file.state || "UNKNOWN"}`);
    if (file.state === "FAILED") {
      throw new Error(
        file.error?.message || "Gemini failed to process the uploaded video."
      );
    }

    await new Promise((resolve) => setTimeout(resolve, FILE_PROCESSING_POLL_MS));
    file = await withTimeout(
      ai.files.get({ name: fileName }),
      OPERATION_TIMEOUT_MS,
      "Timed out while checking the Gemini file state."
    );
  }

  console.log(`[Gemini] File ${fileName} state: ${file.state || "UNKNOWN"}`);
  if (file.state !== "ACTIVE" || !file.uri || !file.mimeType) {
    throw new Error(
      file.error?.message ||
        "Gemini did not make the uploaded video ACTIVE before the timeout."
    );
  }

  return {
    uri: file.uri,
    mimeType: file.mimeType,
  };
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected server error.";
}

function getErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isGeminiRetryable(error: unknown) {
  const status = getErrorStatus(error);
  if (status === 429 || status === 503) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes("429") || message.includes("503") ||
    message.includes("unavailable") || message.includes("rate limit");
}

const generationSchema = {
  type: "object",
  properties: {
    transcript: { type: "string" },
    caption_options: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          caption: { type: "string" },
          hashtags: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["caption", "hashtags"],
      },
    },
  },
  required: ["transcript", "caption_options"],
} as const;

async function generateWithGemini(
  videoBlob: Blob,
  videoMimeType: string,
  id: string,
  apiKey: string,
  onStatus: (message: string) => void
): Promise<GenerationResult> {
  const ai = new GoogleGenAI({ apiKey });
  console.log(`[Reel ${id}] Uploading video to Gemini`);
  const uploadedFile = await withTimeout(
    ai.files.upload({
      file: videoBlob,
      config: {
        mimeType: videoMimeType,
        displayName: `reel-${id}`,
      },
    }),
    OPERATION_TIMEOUT_MS,
    "Timed out while uploading the video to Gemini."
  );

  if (!uploadedFile.name) {
    throw new Error("Gemini did not return an uploaded file.");
  }

  console.log(`[Reel ${id}] Waiting for Gemini file to be ACTIVE`);
  const file = await waitForFileProcessing(ai, uploadedFile.name);
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  for (let attempt = 0; attempt < GEMINI_RETRY_DELAYS_MS.length + 1; attempt += 1) {
    try {
      console.log(`[Reel ${id}] Generating transcript and captions with Gemini`);
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: createUserContent([
            createPartFromUri(file.uri, file.mimeType),
            "Transcribe all spoken words in this video accurately. Detect the language of the speech and write the transcript and all three social media caption options in that same language. Each caption must include relevant hashtags. Return only JSON matching the requested schema.",
          ]),
          config: {
            responseMimeType: "application/json",
            responseJsonSchema: generationSchema,
          },
        }),
        OPERATION_TIMEOUT_MS,
        "Timed out while generating captions with Gemini."
      );

      if (!response.text) {
        throw new Error("Gemini returned an empty response.");
      }

      return parseGenerationResult(JSON.parse(response.text));
    } catch (error) {
      if (!isGeminiRetryable(error) || attempt === GEMINI_RETRY_DELAYS_MS.length) {
        throw error;
      }

      onStatus("AI is busy, retrying...");
      console.warn(
        `[Reel ${id}] Gemini attempt ${attempt + 1} failed; retrying`,
        error
      );
      await new Promise((resolve) =>
        setTimeout(resolve, GEMINI_RETRY_DELAYS_MS[attempt])
      );
    }
  }

  throw new Error("Gemini caption generation failed.");
}

async function generateWithGroq(
  videoBlob: Blob,
  videoMimeType: string,
  id: string,
  apiKey: string
): Promise<GenerationResult> {
  if (videoBlob.size > GROQ_MAX_FILE_SIZE) {
    throw new Error(
      "This video is too large for the backup AI. Choose a video smaller than 25 MB."
    );
  }

  const transcribeModel = process.env.GROQ_TRANSCRIBE_MODEL;
  const chatModel = process.env.GROQ_CHAT_MODEL;
  if (!transcribeModel || !chatModel) {
    throw new Error(
      "The backup AI is not configured. Set GROQ_TRANSCRIBE_MODEL and GROQ_CHAT_MODEL."
    );
  }

  const client = new Groq({ apiKey });
  const file = await toFile(
    Buffer.from(await videoBlob.arrayBuffer()),
    `reel-${id}.${videoMimeType.split("/")[1] || "mp4"}`
  );
  const transcription = await withTimeout(
    client.audio.transcriptions.create({
      file,
      model: transcribeModel,
      response_format: "json",
    }),
    OPERATION_TIMEOUT_MS,
    "Timed out while transcribing the video with the backup AI."
  );

  if (!transcription.text?.trim()) {
    throw new Error("The backup AI returned an empty transcript.");
  }

  const completion = await withTimeout(
    client.chat.completions.create({
      model: chatModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Create exactly three social media caption options from the transcript. Keep every caption and hashtag in the same language as the speech. Return only JSON with this shape: {\"transcript\":\"string\",\"caption_options\":[{\"caption\":\"string\",\"hashtags\":[\"string\"]},{\"caption\":\"string\",\"hashtags\":[\"string\"]},{\"caption\":\"string\",\"hashtags\":[\"string\"]}]}",
        },
        {
          role: "user",
          content: transcription.text,
        },
      ],
    }),
    OPERATION_TIMEOUT_MS,
    "Timed out while generating captions with the backup AI."
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("The backup AI returned an empty caption response.");
  }

  const result = parseGenerationResult(JSON.parse(content));
  return {
    ...result,
    transcript: transcription.text.trim(),
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ error: "A reel ID is required." }, { status: 400 });
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!geminiApiKey && !groqApiKey) {
    return Response.json(
      { error: "AI caption generation is not configured on the server." },
      { status: 503 }
    );
  }

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
    return Response.json(
      { error: "Unable to verify your workspace." },
      { status: 500 }
    );
  }
  if (!member || typeof member.workspace_id !== "string") {
    return Response.json(
      { error: "You are not assigned to a workspace." },
      { status: 403 }
    );
  }

  const { data: reel, error: reelError } = await supabase
    .from("reels")
    .select("workspace_id, video_url")
    .eq("id", id)
    .eq("workspace_id", member.workspace_id)
    .maybeSingle<ReelRow>();

  if (reelError) {
    console.error("Could not load the reel:", reelError);
    return Response.json({ error: "Unable to load the reel." }, { status: 500 });
  }
  if (!reel) {
    return Response.json({ error: "Reel not found." }, { status: 404 });
  }
  if (!reel.video_url) {
    return Response.json(
      { error: "This reel does not have a video to process." },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        console.log(`[Reel ${id}] Downloading video`);
        const videoResponse = await withTimeout(
          fetch(reel.video_url),
          OPERATION_TIMEOUT_MS,
          "Timed out while downloading the video."
        );
        if (!videoResponse.ok) {
          throw new Error(`The video could not be downloaded (${videoResponse.status}).`);
        }

        const videoBlob = await videoResponse.blob();
        const videoMimeType = getVideoMimeType(videoResponse, reel.video_url);
        console.log(`[Reel ${id}] Video downloaded (${videoBlob.size} bytes)`);

        let result: GenerationResult;
        try {
          if (!geminiApiKey) {
            throw new Error("Gemini is not configured on the server.");
          }

          send({ type: "status", message: "AI is transcribing..." });
          result = await generateWithGemini(
            videoBlob,
            videoMimeType,
            id,
            geminiApiKey,
            (message) => send({ type: "status", message })
          );
        } catch (geminiError) {
          if (!groqApiKey) {
            throw geminiError;
          }

          console.warn(`[Reel ${id}] Gemini failed; switching to Groq`, geminiError);
          send({ type: "status", message: "Switching to backup AI..." });
          result = await generateWithGroq(
            videoBlob,
            videoMimeType,
            id,
            groqApiKey
          );
        }

        const { error: updateError } = await supabase
          .from("reels")
          .update({
            transcript: result.transcript,
            caption_options: result.caption_options,
          })
          .eq("id", id)
          .eq("workspace_id", member.workspace_id);

        if (updateError) {
          console.error("Could not save generated reel content:", updateError);
          throw new Error("The captions were generated but could not be saved.");
        }

        send({ type: "result", data: result });
      } catch (error) {
        console.error("Reel generation failed:", error);
        send({
          type: "error",
          message: `Caption generation failed: ${getErrorMessage(error)}`,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
