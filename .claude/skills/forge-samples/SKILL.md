---
name: forge-samples
description: Render sample videos showing how Forge cuts comic pages into panels and animates them (for the user to judge the quality).
---
1. Run the forge-e2e skill setup with a real comic PDF (for example `scratchpad/wm/issue3.pdf`).
2. Panel cutting video: draw each page with its detected panels (`window.__forge.cutPage` or the project shots), numbered in reading order. Grab canvas frames and encode them with ffmpeg.
3. Animation video: auto edit with a profile (premium, cosmic, action…), then `exportMp4` at 1080×1920, 30 fps, quality `max`.
4. Send the MP4s with SendUserFile, with a short French caption saying what each one shows.
