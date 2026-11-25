# Chrome Web Store listing for the K Downloader extension

Publishing (unlisted) is what makes the browser step almost automatic: once the extension has a store id,
the installer's checkbox registers it with Chrome, which fetches it from the store on its next start and shows one
**Enable** bubble; after that it pairs with the app by itself. (Installing with zero clicks would need a browser
policy, which only an administrator can set, so IT can push `ExtensionSettings` through Group Policy for the same id.)

## What you do once

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account that should own it (a company account is best). Pay the one-time $5 developer registration.
2. Press **New item** and upload `extension-store\k-downloader-extension.zip` (made by `app\build.cmd`).
3. Fill the listing from the texts below. Visibility: **Unlisted** (only people with the link, and your installer).
4. Submit for review. It usually takes 1 to 3 days. The item id (32 letters) appears in the console right away.
5. Put that id in `extension\store-id.txt` and run `app\build.cmd` again. From then on the installer offers "Add to Google Chrome" and "Add to Microsoft Edge" checkboxes that work by themselves.

Microsoft Edge installs Chrome Web Store extensions through the same policy, so one listing covers both.

## Listing texts

**Name:** K Downloader

**Summary (132 characters max):**
Download button on YouTube, Facebook, Instagram, TikTok and more, plus a fast download manager. Works with the K Downloader app.

**Description:**
K Downloader is a private tool for the Organix media team. It adds a Download button to video pages and sends every file you download through the K Downloader desktop app, which fetches it in parallel pieces with resume, converts video for editing, and keeps one history for everything.

This extension only talks to the K Downloader app running on your own computer (127.0.0.1:17653). It does not send browsing data anywhere else. It needs the desktop app to do anything.

**Category:** Productivity → Tools

**Language:** English

**Single purpose description (for the review):**
Sends downloads and video page links from the browser to the K Downloader desktop application running on the user's own computer.

**Permission justifications:**
- downloads: to take over a file the user is downloading and hand it to the desktop app, then remove Chrome's own copy of the download.
- contextMenus: the "Download with K Downloader" right-click items.
- storage: the pairing code of the local app and the on/off switch.
- notifications: a short notice when a download was handed over or refused.
- tabs: to open the local pairing page and to know the page a context-menu click came from.
- Host permission http://127.0.0.1:17653/*: the local desktop app's address.
- Content script on all sites: shows the Download button on video pages and lets the user open the download panel on any page from the right-click menu. It reads nothing from pages except what the user asks to download.

**Privacy policy (paste as the policy URL text, or host it on organix-eg.com):**
The K Downloader extension does not collect, store or transmit personal data. All communication is with the K Downloader application on the user's own computer. No analytics, no remote servers, no accounts.

**Assets:** icon `extension\icons\128.png`; screenshots 1280×800 of the Download button on YouTube and of the popup (take them from Chrome once the extension is loaded).
