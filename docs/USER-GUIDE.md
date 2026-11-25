# K Downloader

**Kareem Downloader Tool** by Kareem Waheed.

Save videos up to 4K (limited by the best quality of the original) or audio only as MP3, M4A or WAV.
No ads, no tracking, and no code fetched from outside servers, except the official yt-dlp engine updating itself from GitHub with its published checksum. The script only talks to the helper on your own PC.

## Install

**The app (recommended):** run the `K Downloader Setup` file in `dist\` (short steps in `dist\INSTALL.txt`). The installer carries the developer credit (Kareem Waheed, https://www.linkedin.com/in/kareemtokka/); its last page opens the app, which shows a three-step setup guide: load the browser extension (the browser opens on its extensions page with the folder path already copied), Claude (registered automatically in Claude Code and the Claude desktop app on every start, even when Claude is installed later), and where files go. The setup has a **Browser extension** page: once the extension is published on the Chrome Web Store (see `extension-store\LISTING.md`), ticking **Add to Google Chrome** or **Add to Microsoft Edge** registers it; the browser fetches it on its next start, asks once to **Enable** it, and it connects by itself. Until then the page shows the one manual step. For silent team installs: `"K Downloader Setup x.y.z.exe" /S /EXT=chrome,edge`. Windows may warn about an unknown publisher because the installer isn't code-signed yet (see `SIGNING.md`); choose More info, Run anyway. The app sits in the tray, starts with Windows, registers itself with Claude Code, and has its own window for downloads, pasted links, history and settings. For the browser button, open Settings in the app and press **Install in Chrome**, then **Confirm installation** in OrangeMonkey.

To build the installer yourself: run `app\build.cmd` (needs Node.js and internet the first time).

**Script only (no app):** you need Chrome with the OrangeMonkey extension, on 64-bit Windows.

1. Double-click `install.cmd`.
2. An OrangeMonkey page opens. Press **Confirm installation**.

The helper then starts by itself, with no window, every time you sign in to Windows. Don't use both methods on one PC: the app takes over startup and removes the script-only shortcut.

If the confirm button is grey: open `chrome://extensions`, open the OrangeMonkey details and turn on **Allow User Scripts**.

Files are saved to `Downloads\K Downloader`.

## Using it

- On YouTube the **Download** button sits next to Share. On Reels and Shorts it sits above Like.
- On other sites a round button appears on the video.
- Press it and pick a quality or audio format.
- If the button doesn't appear on a site: open the OrangeMonkey icon and choose **Download from this page**.

## Features

- **Edit format:** pick it before choosing a quality. **H.264 MP4** is small and opens everywhere. **ProRes 422** and **DNxHR HQ** (MOV, PCM audio) scrub smoothly on a 4K timeline but are very large: about 7 GB and 12 GB per minute of 4K60. Everything comes out at a constant frame rate. H.264 uses the graphics card when it can; ProRes and DNxHR always use the processor.
- **Cut a part:** drag the start and end handles on the bar, and the video moves with them so you see the exact frame. You can also type From and To, or press **Current time**. Arrow keys move a selected handle by 1 second, and Shift + arrow by 0.1 second. Works for video and audio, so you can save a single part as MP3.
- **Subtitles:** pick a language, then keep them inside the file, burn them into the picture, or save a separate SRT.
- **Frame at current time:** saves the frame where the video is paused as a full-quality PNG, up to 4K.
- **Thumbnail:** best available quality as JPG.
- **Links tab:** paste any text with links, one or many, and they all download with the same quality and edit format. Also in the OrangeMonkey menu: **Download a list of links**.
- **Playlists:** open a YouTube playlist and select the videos and quality. Files go into a folder named after the playlist (up to 300 videos).
- **History:** every download with search by name. If you already downloaded the same version, the tool asks before repeating it. Playlists skip those automatically.

## Any file, fast (the Chrome extension)

K Downloader also downloads plain files the way a download manager does: 16 parallel connections, resume after a cancel or a dropped connection, and every file lands in the same downloads folder and history.

- **In the app:** paste any direct link on the Download page. If it isn't a video page, press **Download as a file instead**. The Links tab does this by itself.
- **From Chrome:** install the extension in `extension\` (in the app: Settings, **Open folder**). Open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked** and pick that folder. Then click the K icon in Chrome and press **Connect**. The extension also puts the **Download** button on video pages, so OrangeMonkey and the userscript are no longer needed. Files you download in Chrome go through K Downloader, and a right-click gives **Download with K Downloader** on links, images and videos, and **Open K Downloader on this page** anywhere. The switch in the popup turns capturing off. Files that only exist behind a login (cPanel logs, Drive exports, a client's portal) work too: the extension passes the page's cookies for that one link to the helper on this PC, nowhere else. If the helper still cannot get a file, Chrome saves it the normal way and tells you. After an update, press the reload arrow on the extension's card in `chrome://extensions` (version 1.2 asks once to allow the new site access).
- **From Claude Code:** the `download_file` tool.

Chrome keeps the extension only while its folder stays where it is.

## Subtitles from speech (AI, on this PC)

When a video has no subtitles, K Downloader can listen and write them itself with whisper.cpp, offline. In the subtitle language list pick **AI subtitles: Arabic**, **English** or **Detect language**, then either keep them inside the file, burn them in, or save an SRT (row **AI subtitles ar** under Other files). The first use downloads the speech model once (about 550 MB). On this PC it takes about as long as the clip itself, so for a long video cut the part you need first.

**Translated subtitles:** next to the subtitle language, pick **Translate to English** or **Translate to Arabic**. An SRT job then writes a second, translated SRT; a video job embeds or burns the translated one and keeps the original SRT beside the file. The translation is machine translation (Google Translate's web service, no key); for careful wording ask Claude to read the SRT and translate it, then save it with `write_subtitles`.

**GPU speech engine:** on a PC with an NVIDIA card, Settings offers an optional 650 MB download that makes subtitles several times faster. It needs NVIDIA driver 551 or newer. If it fails to start, the processor build is used automatically.

Claude Code: `transcribe` ("write Arabic subtitles for this link from 2:00 to 5:00, and an English translation"), `download` with `ai_subtitles: "ar"` and `subtitle_translate_to: "en"`, `translate_subtitles`, `write_subtitles`.

## Built to be relied on

- **Starts itself and stays up.** The app registers a Task Scheduler task that starts it hidden 15 s after sign-in and starts it again if it ever crashes; the app restarts the helper if it stops answering; and Claude Code starts the app by itself when it finds it closed.
- **Nothing is lost on a restart.** Unfinished downloads are kept in `queue.json` and picked up again when the helper starts; partial files resume.
- **Dropped connections are retried** three times (10 s, 30 s, 60 s) before a job is marked failed.
- **Source health.** Settings shows every search site with its last daily check; a site that used to answer and now gives nothing is marked broken. Claude Code: `check_sources`.
- **Preflight.** `app\build.cmd` runs `tests\preflight.js` first (syntax, search modules, a real helper doing real downloads, projects, presets, retries); no installer is made unless it passes.

**Setting up another PC:** install from `dist\`, open the app once (it registers the startup task and Claude Code), restart Claude Code there, then double-click `check.cmd` in this folder: it prints one line per item (app, helper, startup task, Claude Code registration, pairing code, browser logins, Chrome extension, projects folder, source health, GPU engine) and what to do about anything missing. Claude Code reads `CLAUDE.md` in this folder on every PC, so it knows the rules (free sources only, ask where to save, references never published) without any copying.

## Projects, folders and the cache

Settings has three folders. **Downloads folder** is where everything goes by default. **Projects folder** is optional: point it at your projects root, pick a project in Settings (or tell Claude `use_project "Olive Oil Launch"`), and from then on references go to `02 References`, stock clips to `03 Footage`, photos to `04 Photos` inside that project, each with `credits.txt` and `manifest.csv` (file, title, author, licence, source, length, size) that Premiere's Media Browser imports as bins alongside the files. Pick "Downloads folder" again to leave the project. **Cache folder** holds partial downloads, speech models and the GPU engine, and can live on a bigger drive.

Claude Code is told to ask where files should go whenever you did not say.

## For the timeline

On request, `download_videos` and `build_asset_pack` convert stock clips with `edit_format` (h264, prores, dnxhr) and write 540p **proxies** into a `Proxies` subfolder (`proxies: true`). `download` takes a **preset** that reframes a video for a platform by scaling to fill and cropping the centre: `reel`/`story` 1080×1920, `square` 1080×1080, `portrait` 1080×1350, `landscape` 1920×1080, combined with start/end to cut.

## Updates

Settings has an **App updates** source: a shared folder (a synced Drive folder works) or a web address holding the newest `K Downloader Setup x.y.z.exe` and the `latest.json` that `app\build.cmd` writes next to it. Every PC checks it every 6 hours, downloads a newer installer, verifies its checksum, and installs it quietly at the next sign-in (or when you press **Install update**). Point every team PC at the same folder once.

## The built-in browser

The **Browser** page is a small browser inside the app with its own logins. Sign in to Facebook, Instagram, YouTube or any site there once; downloads then use those logins (no `cookies.txt` needed), and so does Claude through `browser_open`, `browser_read` and `browser_download`. **Download this page** sends the page you're on to the Download page. Files you download inside it go through the download manager. **Sign out of everything** clears its logins.

Claude can only navigate, read and download in this browser; it cannot type into pages or press buttons there. Anything it reads from a page is treated as data, not instructions.

## Finding photos

The **Images** page searches by description and downloads what you pick, in the size you choose, into `DownloadsK DownloaderImages<search>` with a `credits.txt` naming the author and licence of each file. No keys: the app opens each site's own search page in a hidden browser window and reads the pictures off it, so it needs the app running (not the script-only install).

| Source | Use |
|---|---|
| Pexels, Pixabay, Unsplash | Free to use, also commercially (each site's licence) |
| Openverse (Flickr, museums and more), Wikimedia Commons | Licence shown per photo: CC0, CC BY and CC BY-SA allow commercial use |
| Google Images, Bing Images, Yandex Images, Pinterest | **Reference only.** No licence comes with these; never publish them |

The free sources are on by default; tap a grey chip to add a reference source. The licence tag on every result is green when commercial use is allowed. Sign in to Pinterest or Google on the **Browser** page once to get their full results. Paid stock sites are left out on purpose. When Google asks to check you are human (it does this when many searches come from one network), a window opens for you to answer it once, then closes by itself and the search continues; Bing and Yandex give similar references without that check. Pixabay serves up to 1280 px without a login.

Claude Code can do the same with `search_images` and `download_images`: "find 10 portrait photos of a girl with blue eyes and download them in large size", or "give me 20 Pinterest references for a kitchen shoot".

## Free footage

The **Footage** page searches free stock video the same way: **Pexels Videos** and **Pixabay Videos**, both free for commercial use, read through the app's hidden browser with no keys. Hover a clip to play its preview, filter by shape and length, pick 720p, 1080p, 4K or best available, and the clips land in `Downloads\K Downloader\Footage\<search>` with a `credits.txt`. Paid stock sites are left out on purpose.

**References:** the grey **YouTube** and **Dailymotion** chips search those platforms too, for inspiration and internal reference only (other people's videos, never for publishing). Their clips download through the video engine at the quality you pick, into the same folder, marked "Reference only" in `credits.txt`. Vimeo was left out because its search page asks for a human check on every visit.

Claude Code: `search_videos` and `download_videos` ("find 10 drone clips of olive groves and download the 5 best in 4K", "show me 10 YouTube references for olive oil ads").

## Shot list to folder

Give Claude a shot list and it builds the whole folder: `build_asset_pack` takes a pack name and shots (title, search words, how many photos and clips each), searches only the free sources, and writes `Downloads\K Downloader\Packs\<name>\01 <shot>\...` with a `credits.txt` in every folder and a `README.txt` listing each shot, its search words and counts. Say for example: "build an asset pack called Olive Harvest Film with 6 shots: ...".

## Channels and playlists

`get_playlist` and `download_playlist` take a playlist or a channel page (`youtube.com/@name/videos`, newest first) with `limit` and `after` (a date), so "download the latest 5 videos of this channel" or "everything this channel posted since 2026-11-01" is one request. Already-downloaded videos are skipped.

## Using it from Claude Code

K Downloader is also an MCP server, so Claude Code can download for you. `install.cmd` registers it for your user, and Claude Code picks it up after a restart. Then ask in plain words, for example:

- "Download this video in 4K as ProRes: <link>"
- "Save the audio of <link> as MP3 from 1:20 to 2:05"
- "Grab a frame from <link> at 0:42"
- "Download the first 5 videos of this playlist in 1080p into a folder called Promo"
- "What did I download yesterday?"

Claude only reaches the helper on this PC, with the same pairing code as the browser script. If Claude says the helper is not running, start it with `start.cmd`.

## If something stops working

| Problem | Fix |
|---|---|
| "The K Downloader helper is not running" | Run `install.cmd` again, or `start.cmd` to see the error |
| A site changed or a video won't download | The engine updates itself once a day and retries a job once after updating. You can also press **Update engine** |
| "This video needs a login" | Export a cookies file for that site, name it `cookies.txt` and put it in `%LOCALAPPDATA%\K Downloader`. See the warning below |
| "That code is not correct" | Run `install.cmd` again and press Confirm installation |

## Good to know

- **4K on YouTube comes as VP9 inside MP4.** It plays in VLC, Chrome and most modern players, but Premiere may not open it. Pick an **Edit format** for those files. Up to 1080p the tool prefers H.264, which opens everywhere.
- **MP3 at 320 doesn't add quality beyond the source.** YouTube usually sends audio around 130 kbps, and the panel shows the source number.
- **Graphics card:** H.264 conversion uses NVIDIA/Intel/AMD encoders when the driver supports them. This ffmpeg build needs NVIDIA driver 610 or newer; older drivers fall back to the processor, which is much slower at 4K.
- **HDR:** the tool prefers the SDR version when a site offers both. A video that exists only in HDR may look washed out after conversion.
- **Cancelling a live stream discards the recording.** The file is only saved when the stream ends.
- DRM-protected content (Netflix and similar) can't be downloaded.
- Only download content you own or have permission to use.
- Don't install the SaveFrom script next to this one, because it runs code fetched from their servers.

## Privacy and security

- **`cookies.txt` is as sensitive as a password.** It gives whoever holds it access to that account without a password or a code. Use a separate account made for this, delete the file when you're done, and never send it to anyone.
- Your history, pairing code and cookies live in `%LOCALAPPDATA%\K Downloader`, outside the program folder, so they don't travel when you share or sync the program.
- The helper only listens on your own PC and rejects any request without the pairing code.

## Sharing with the team

Copy the whole folder. Each PC runs `install.cmd`. The folder has to stay where it is after installing.

## Uninstall

Run `uninstall.cmd`, then press Remove on the script in OrangeMonkey. To remove your history too, delete `%LOCALAPPDATA%\K Downloader`.

## Open-source components

`bin` contains yt-dlp, ffmpeg and Node.js. This ffmpeg build is GPL-licensed, so sharing it outside the team means following that license.
