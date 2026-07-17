# Shelf & Sleeve

A small web app for tracking your book and vinyl collection: add items with a cover photo, search and filter, keep a wishlist, and see stats (totals, breakdown by format/genre, total spent).

It works immediately with no setup, storing data in your browser. Optionally, connect it to a GitHub repo so the same collection shows up on your phone and computer.

## 1. Try it right now

Just open `index.html` in a browser (double-click it). Add a few items — everything saves to that browser automatically. This is a good way to try it before putting it on GitHub.

## 2. Put it on GitHub (so you can use it from your phone too)

**Create the repo**
1. Go to github.com and create a new repository (e.g. `my-collection`). Public is required for the free hosting step below — that means the titles, notes, and cover photos you enter will be visible to anyone with the link, though the repo won't be listed anywhere or show up in search. If that's not okay, skip step "Enable GitHub Pages" and instead just open `index.html` locally on each device, or host it privately some other way.
2. Upload all the files in this folder (`index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`, `data.json`, `icon-192.png`, `icon-512.png`) to the repo. Easiest way: on the repo page, use "Add file → Upload files" and drag them all in, then commit.

**Enable GitHub Pages**
1. In the repo, go to Settings → Pages.
2. Under "Build and deployment", set Source to "Deploy from a branch", branch `main`, folder `/ (root)`, then Save.
3. After a minute, GitHub shows you a URL like `https://yourusername.github.io/my-collection/`. That's your app — open it on your phone and computer, and add it to your home screen (Safari/Chrome: Share → Add to Home Screen) so it behaves like an app.

**Create an access token so the app can save data to your repo**
1. Go to github.com → Settings (your account, not the repo) → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
2. Set "Repository access" to "Only select repositories" and pick your new repo.
3. Under Permissions → Repository permissions, set "Contents" to Read and write.
4. Generate the token and copy it (you won't be able to see it again).

**Connect the app**
1. Open the app, go to the Settings tab.
2. Fill in your GitHub username, the repo name, branch (`main`), and paste the token.
3. Click "Test connection" to confirm it works, then "Save & connect".

From then on, every change you make on any device syncs to a `data.json` file in your repo, and each device pulls the latest copy when you open the app.

A couple of things worth knowing:
- The token is stored only in that browser's local storage — it's never uploaded anywhere. You'll need to enter it again on each new device/browser.
- If you ever edit the collection on two devices while both are offline at the same time, the version with the most recent change wins when they next sync — there's no merge, just newest-wins.
- Use the Settings tab's "Export JSON" any time you want a manual backup file.

## 3. Send me your existing list

If you already have a list of books/vinyls (spreadsheet, notes app, whatever), paste or attach it in chat and I'll turn it into the starting `data.json` for you.

## Adding items day to day

Use "+ Add item" (Collection tab) or "+ Add to wishlist" (Wishlist tab). You can attach a photo of the physical book or record — it's automatically resized so the file stays small. Tap any item to see its full details, edit, or delete it.

## Files in this folder

- `index.html`, `styles.css`, `app.js` — the app itself
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` — let it be "installed" as an app icon on your phone
- `data.json` — starting (empty) collection data
