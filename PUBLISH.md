# Publishing the Oasis site on GitHub Pages

The marketing page and the download both live in **`docs/`**, which is the one
folder GitHub Pages can serve straight from your `main` branch — no separate
`gh-pages` branch, no build step.

```
docs/
  index.html            the Oasis landing page
  assets/               hero images
  download/Oasis.zip    the packaged app (built by Package Oasis.bat)
  .nojekyll             tells Pages to serve the folder as-is
```

## One-time publish

1. **Build the download** so `docs/download/Oasis.zip` is current:
   - Double-click **`Package Oasis.bat`** (or run `powershell -File package.ps1`).

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
   The download button points at `./download/Oasis.zip`, so it just works.

## Updating later

Whenever you change the app or the page:

```powershell
powershell -File package.ps1      # refreshes docs/download/Oasis.zip
git add .
git commit -m "Update Oasis"
git push
```

Pages redeploys automatically on every push to `main`.

## Notes

- **`Oasis.zip` is ~18 MB** (it bundles the looping ocean videos). That's fine
  for GitHub Pages (100 MB/file limit). If you'd rather not commit a binary that
  size, attach the zip to a **GitHub Release** instead and change the download
  link in `docs/index.html` from `./download/Oasis.zip` to the release asset URL.
- Want a custom domain? Add a `CNAME` file in `docs/` with your domain and set it
  under Settings → Pages → Custom domain.
- The same `docs/index.html` is also served locally by the app at
  `http://localhost:7777/site/` for quick previewing.
