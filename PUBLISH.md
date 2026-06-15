# Publishing the Oasis site on GitHub Pages

The marketing page and the downloads all live in **`docs/`**, which is the one
folder GitHub Pages can serve straight from your `main` branch — no separate
`gh-pages` branch, no build step.

```
docs/
  index.html                   the Oasis landing page (interactive canvas sea)
  assets/                      hero images
  download/Oasis-Windows.zip   the packaged Windows app (built by Package Oasis.bat)
  download/Oasis-macOS.zip     the packaged macOS app
  .nojekyll                    tells Pages to serve the folder as-is
```

## One-time publish

1. **Build the downloads** so both zips in `docs/download/` are current:
   - Double-click **`Package Oasis.bat`** (or run `powershell -File package.ps1`).
   - This writes `Oasis-Windows.zip` and `Oasis-macOS.zip`; the landing page
     auto-highlights the right one for each visitor's OS.

2. **Put the project on GitHub** (if it isn't already):
   ```powershell
   cd "C:\Users\T570\Documents\IDEASONLY"
   git init
   git add .
   git commit -m "Oasis: app + GitHub Pages site"
   git branch -M main
   git remote add origin https://github.com/<you>/oasis.git
   git push -u origin main
   ```
   Create the empty `oasis` repo on github.com first (no README), then run the
   `remote add` / `push` lines above.

3. **Turn on Pages:** on github.com open the repo → **Settings → Pages**. Under
   *Build and deployment*, set **Source = Deploy from a branch**, **Branch =
   `main`**, **Folder = `/docs`**, then **Save**.

4. Wait ~1 minute. Your site goes live at:
   ```
   https://<you>.github.io/oasis/
   ```
   The download buttons point at `./download/Oasis-Windows.zip` and
   `./download/Oasis-macOS.zip`, so they just work.

## Updating later

Whenever you change the app or the page:

1. For a new **release**, bump the `VERSION` constant in `server.js` — that's the
   single source of truth. `package.ps1` reads it and stamps the same number into
   `docs/version.json` (the update manifest), so a running copy can tell a newer
   version has shipped. (Add a matching section to `CHANGELOG.md` too.)
2. Refresh the zips and push:

```powershell
powershell -File package.ps1      # rebuilds both zips + stamps docs/version.json from VERSION
git add .
git commit -m "Update Oasis"
git push
```

Pages redeploys automatically on every push to `main`.

## Notes

- **Each zip is ~18 MB** (both bundle the looping ocean videos). That's fine
  for GitHub Pages (100 MB/file limit). If you'd rather not commit binaries that
  size, attach them to a **GitHub Release** instead and change the download
  links in `docs/index.html` from `./download/Oasis-Windows.zip` /
  `./download/Oasis-macOS.zip` to the release asset URLs.
- Want a custom domain? Add a `CNAME` file in `docs/` with your domain and set it
  under Settings → Pages → Custom domain.
- The same `docs/index.html` is also served locally by the app at
  `http://localhost:7777/site/` for quick previewing.
