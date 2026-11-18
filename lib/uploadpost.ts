const UPLOAD_POST_URL = "https://api.upload-post.com";

export type UploadPostPlatform =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "youtube";

export type PublishVideoInput = {
  videoUrl: string;
  caption: string;
  youtubeTitle?: string | null;
  platforms: readonly string[];
  scheduledAt: string;
  externalId: string;
};

export type PublishVideoResult = {
  jobId: string;
};

export type UploadPostStatus = {
  status: string;
  message?: string;
  results: Array<{
    platform: string;
    success?: boolean;
    status?: string;
    message?: string;
  }>;
};

function getCredentials() {
  const apiKey = process.env.UPLOAD_POST_API_KEY;
  const user = process.env.UPLOAD_POST_USER;
  if (!apiKey || !user) {
    throw new Error("Upload-Post is not configured on the server.");
  }
  return { apiKey, user };
}

function getPlatform(platform: string): UploadPostPlatform {
  if (platform === "youtube_shorts") {
    return "youtube";
  }
  if (
    platform === "instagram" ||
    platform === "facebook" ||
    platform === "tiktok" ||
    platform === "linkedin" ||
    platform === "youtube"
  ) {
    return platform;
  }
  throw new Error(`Unsupported Upload-Post platform: ${platform}`);
}

async function readResponse(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : `Upload-Post request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

export async function publishVideo(
  input: PublishVideoInput
): Promise<PublishVideoResult> {
  const { apiKey, user } = getCredentials();
  const form = new FormData();
  form.append("user", user);
  form.append("video", input.videoUrl);
  form.append("title", input.caption);
  form.append("description", input.caption);
  form.append("scheduled_date", input.scheduledAt);
  form.append("external_id", input.externalId);

  const platforms = input.platforms.map(getPlatform);
  if (platforms.length === 0) {
    throw new Error("At least one Upload-Post platform is required.");
  }
  for (const platform of platforms) {
    form.append("platform[]", platform);
  }
  if (platforms.includes("youtube") && input.youtubeTitle) {
    form.append("youtube_title", input.youtubeTitle);
    form.append("youtube_description", input.caption);
  }

  const response = await fetch(`${UPLOAD_POST_URL}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Apikey ${apiKey}` },
    body: form,
  });
  const body = await readResponse(response);

  if (
    typeof body !== "object" ||
    body === null ||
    !("job_id" in body) ||
    typeof body.job_id !== "string"
  ) {
    throw new Error("Upload-Post did not return a scheduled job ID.");
  }

  return { jobId: body.job_id };
}

export async function getUploadPostStatus(
  jobId: string
): Promise<UploadPostStatus> {
  const { apiKey } = getCredentials();
  const url = new URL(`${UPLOAD_POST_URL}/api/uploadposts/status`);
  url.searchParams.set("job_id", jobId);

  const response = await fetch(url, {
    headers: { Authorization: `Apikey ${apiKey}` },
  });
  const body = await readResponse(response);
  if (
    typeof body !== "object" ||
    body === null ||
    !("status" in body) ||
    typeof body.status !== "string" ||
    !("results" in body) ||
    !Array.isArray(body.results)
  ) {
    throw new Error("Upload-Post returned an invalid status response.");
  }

  return {
    status: body.status,
    message:
      "message" in body && typeof body.message === "string"
        ? body.message
        : undefined,
    results: body.results.filter(
      (result): result is UploadPostStatus["results"][number] =>
        typeof result === "object" &&
        result !== null &&
        "platform" in result &&
        typeof result.platform === "string"
    ),
  };
}
