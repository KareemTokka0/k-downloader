# Contributing

1. Clone, then run `tools\fetch-tools.cmd` once to fill `bin\`.
2. Run the helper and app from source: `app\start-dev.cmd` is not needed; `cd app && npm install && npm start`.
3. Before a pull request, run `bin\node.exe tests\preflight.js`: syntax, unit tests, the extension's decisions in
   a fake Chrome, and a live helper doing real downloads. `--quick` skips the live part.
4. `extension\content.js` is generated from `kareem-downloader.user.js` by `helper\make-content.js`; edit the
   userscript.
5. Keep the rules in `CLAUDE.md`: free sources only, no CAPTCHA or Cloudflare bypass of any kind, and the helper
   never trusts a request without the pairing code.

Releases: a maintainer tags `vX.Y.Z`; GitHub Actions builds the installer and publishes the release.
