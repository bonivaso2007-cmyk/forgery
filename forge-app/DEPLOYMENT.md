# FORGE GitHub Pages deployment guide

This app is now prepared for a public GitHub Pages deployment.

## What is already configured

- `package.json` includes `predeploy` and `deploy` scripts.
- `vite.config.ts` supports a `BASE_PATH` environment variable for GitHub Pages.
- `.github/workflows/deploy.yml` deploys the built site automatically on pushes to `main`.

## 1) Create the GitHub repository

1. Create a new public repository on GitHub, for example `forgery`.
2. Push your local project to that repository.

Example commands:

```bash
cd /path/to/forgery
git init
git branch -M main
git remote add origin https://github.com/<your-username>/forgery.git
git add .
git commit -m "Initial FORGE release"
git push -u origin main
```

## 2) Replace the placeholder homepage

Edit `forge-app/package.json` and replace:

```json
"homepage": "https://<your-username>.github.io/forgery"
```

with your real repository URL:

```json
"homepage": "https://<your-username>.github.io/forgery"
```

## 3) Install dependencies and build locally

```bash
cd forge-app
npm install
npm run build
```

You should see `dist/` generated.

## 4) Deploy manually (optional)

If you do not want to wait for GitHub Actions, run:

```bash
cd forge-app
npm run deploy
```

This publishes the `dist/` folder to the `gh-pages` branch.

## 5) Enable GitHub Pages

1. Open your repo on GitHub.
2. Go to **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. The workflow in `.github/workflows/deploy.yml` will publish automatically on each push to `main`.

## 6) Verify the live site

After the workflow completes, your site will be available at:

```text
https://<your-username>.github.io/forgery/
```

## 7) Recommended database plan for a real online product

The current app is browser-local only. For a true multi-user production experience, the recommended path is:

- **Auth + user table:** Supabase Auth + Postgres
- **Project data / memory:** Supabase Postgres or Firestore
- **File storage / optional uploads:** Supabase Storage
- **Serverless APIs:** Supabase Edge Functions or Vercel serverless functions

Why this path works well:

- Built-in auth providers like Google, Microsoft, email/password
- Very fast setup for a founder-facing app
- Free tier is usually enough for a prototype and early traffic
- Strong security and row-level access control

If you want a more Google-style stack, Firebase Auth + Firestore is the alternative.

## 8) Next backend steps

When you are ready to go beyond localStorage, the next milestones are:

1. Move user data from browser localStorage to a real database.
2. Add provider-based login (Google, Microsoft, email/password).
3. Add server-side API routes for secure AI calls and memory persistence.
4. Add a hosted admin / dashboard view for your user records.

If you want, I can wire the next phase into a Supabase-backed version next.
