# Project: Reels Automation Dashboard

## Goal
A dashboard to upload podcast reels, generate AI captions, save drafts,
choose platforms, schedule posts and publish them through the Upload-Post API.

## Stack
* Next.js (App Router) with TypeScript
* Tailwind CSS
* Supabase (database, auth, storage)
* Upload-Post API for publishing
* Gemini API for captions

## Rules
* Keep all API keys on the server only. Never put them in client code.
* Read keys from environment variables.
* Put all Upload-Post calls in lib/uploadpost.ts only.
* Add a workspace_id column to every table.
* Use TypeScript types for all data.
* Keep components small and simple.
* Do not add features I did not ask for.
* Work on one task at a time from TASKS.md.

## Reel statuses
draft, scheduled, posted, failed