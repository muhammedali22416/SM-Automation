# PRD: Reels Automation Dashboard

## Users
Podcast owner and team. Non technical, they only log in and use the dashboard.

## Main flow
1. User logs in.
2. User uploads a reel (video file).
3. System converts speech to text.
4. AI generates captions and hashtags.
5. User selects a caption and a cover image (select or upload).
6. Reel is saved as a Draft.
7. User selects platforms: Instagram, Facebook, TikTok, LinkedIn, YouTube Shorts.
8. User picks date and time and schedules the reel.
9. System publishes automatically at that time through Upload-Post.
10. Status updates to Posted or Failed.

## Pages
* Login
* Reels list (all reels with status)
* Upload reel
* Reel detail (caption, cover, platforms, schedule)
* Calendar (all scheduled reels)

## Rules
* Each reel can go to any selected platforms, not always all five.
* Nothing is published until the user schedules or approves it.
* Volume: 80 to 100 reels per month.

## Out of scope
AI generated covers, video editing, mobile app.