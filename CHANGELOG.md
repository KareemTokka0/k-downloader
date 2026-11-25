# Changelog

## 3.12.1 (2026-11-23)
- The browser extension takes only downloads it can repeat: a file link, or a file of 20 MB and more. Small
  generated files (invoices, reports, exports behind a login) stay in the browser.
- A 4xx answer other than 401/404/405/410/429 is final; only rate limits and server errors are retried.

## 3.12.0 (2026-11-23)
- Never a fake backup again: every saved file is checked (HTML where a .gz/.zip/.pdf/.sql was promised, wrong
  magic bytes) and refused with `html-instead-of-file`; the download goes back to the browser.
- The extension records each request's method and headers; POST (form) downloads, cPanel/WHM/webmail ports,
  `/cpsess`, phpMyAdmin and account/security pages are never captured.
- yt-dlp trusts the Windows certificate store, so antivirus HTTPS scanning (Avast and others) no longer breaks it.
- `app.log` in the data folder records starts, quits and helper restarts; the start-up task retries every
  10 minutes if the app is not running.
- Builds land in `dist\review`; `app\release.cmd` publishes after review.

## 3.11.x (2026-11-12 to 11-14)
- Files behind a login download with the page's cookies (extension 1.2); file jobs show file-specific errors.
- Temp folder pinned for every tool (fixes "Permission denied: System32" after sign-in start).
- Form (POST) downloads and account/security pages left to the browser (HTTP 405 handling).

## 3.10.0 (2026-11-08)
- Branded installer with developer credit, first-run setup page, automatic Claude Code and Claude Desktop
  registration, start-up task with restart, source health, queue persistence and retries, projects and cache
  folders, Premiere/DaVinci formats and proxies, social presets, free footage search, reference-only video sources.
