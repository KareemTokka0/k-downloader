# Signing the installer

Without a code-signing certificate, Windows shows "Unknown publisher" and SmartScreen may block the first run of `K Downloader Setup.exe`. Signing removes that. The build is already prepared; what is missing is a certificate, which only the company can obtain.

## Options

| Option | Cost | What it needs | Notes |
|---|---|---|---|
| **Azure Trusted Signing** (recommended) | About $10 per month | An Azure account for Organix, identity validation of the company (a few days), and the Azure CLI signed in on the build PC | Microsoft's own service. No USB token. SmartScreen reputation builds quickly. |
| **OV certificate** from Sectigo, DigiCert, SSL.com (through a reseller) | About $200 to $400 per year | Company documents, and the certificate is delivered on a USB token or in a cloud HSM (required since 2023) | The token must be plugged into the build PC each time. |
| **EV certificate** | About $300 to $600 per year | Same, stricter validation | Immediate SmartScreen trust. |

Individual (non-company) certificates exist but cost about the same and validate the person instead of Organix.

## Once you have it

**Azure Trusted Signing:** run `az login` once on the build PC, then set these before `app\build.cmd`:

```bat
set KD_SIGN_AZURE=1
set KD_SIGN_AZURE_ENDPOINT=https://weu.codesigning.azure.net
set KD_SIGN_AZURE_ACCOUNT=<your signing account name>
set KD_SIGN_AZURE_PROFILE=<your certificate profile name>
```

**OV/EV certificate on a token:** plug the token in, install its driver, then set the certificate's subject name (the company name as printed on the certificate):

```bat
set KD_SIGN_SUBJECT=Organix
```

`build.cmd` passes these to electron-builder, which signs `K Downloader.exe`, the uninstaller and the installer, with a timestamp so the signature outlives the certificate. The bundled `yt-dlp.exe`, `ffmpeg.exe`, `node.exe` and `aria2c.exe` keep their own publishers' signatures or stay unsigned; that does not trigger the installer warning.

Check a signed build with:

```bat
signtool verify /pa /v "dist\K Downloader Setup 3.3.0.exe"
```
