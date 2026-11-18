# Architecture

## Folder structure
app/
  login/
  reels/            (list, upload, detail)
  calendar/
  api/
    reels/          (create, generate caption, schedule)
lib/
  supabase.ts       (database and auth client)
  uploadpost.ts     (all Upload-Post API calls, only here)
  ai.ts             (transcript and caption generation)
types/
  index.ts

## Database tables (Supabase)
workspaces
* id, name

members
* user_id, workspace_id, role

reels
* id, workspace_id, video_url, cover_url, transcript
* caption_options (json, AI suggestions), caption, hashtags
* status (draft, scheduled, posted, failed)
* scheduled_at, created_at

reel_platforms
* id, reel_id, platform, status, error

## Storage
Supabase Storage for videos and covers while testing.
Upload directly from the browser, not through our server.

## Security
* Row Level Security on every table using workspace_id.
* API keys only in environment variables on the server.

## Flow
1. Browser uploads video to storage and creates a reel row.
2. Server route creates the transcript and AI caption options.
3. User selects caption, cover and platforms, then schedules.
4. Server route calls lib/uploadpost.ts with the video, caption, platforms and time.
5. Status is updated to scheduled, then posted or failed.

## Upload-Post
Follow the official docs: https://docs.upload-post.com
Use one API key from environment variables.