# Security

K Downloader runs a helper on `127.0.0.1:17653`. It listens on this PC only and refuses any request without the
pairing code stored in `%LOCALAPPDATA%\K Downloader\pairing-code.txt`. Browser cookies the app's own browser
collects are written to a temporary file that is deleted when the helper stops, and never leave the PC.

If you find a way to make the helper act on a request from a web page or another user, please report it
privately through GitHub's **Report a vulnerability** button on the Security tab of this repository (private to the maintainer) instead of opening a public issue. You will get an answer within a week.
