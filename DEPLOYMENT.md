# Deploying Symplicare AI

Two pieces, because they need different things. The web app is static files and
belongs on a CDN. The API is a long-lived Node process with a database, uploads
on disk and sessions held between two requests — it needs a server.

```
browser ──▶ web app (static) ──/api/*──▶ API (Node) ──▶ MongoDB Atlas
```

**The API goes on Render.** The web app can go on Render too, as a static site,
or on Vercel — pick one, section 3 covers both. Everything on Render is the
simpler answer: one dashboard, one bill, one place to look when something
breaks.

Whichever you pick, every `/api` call goes through the site's own origin via a
rewrite, never straight to the API hostname. That is not decoration: the
session cookie is `sameSite: strict`, so a browser will only send it back to
the origin that set it. Point the web app at the API's hostname directly and
sign-in appears to work, then every page says you are signed out.

Do it in this order. The API first, because the web app needs its URL.

---

## 1. MongoDB Atlas — let Render connect

Atlas refuses every IP by default, so this has to be done first or the API will
start and then fail its first query.

1. Atlas → your cluster → **Network Access** → **Add IP Address**
2. Either paste Render's outbound IPs (Render dashboard → your service →
   **Connect** → *Outbound*), or use `0.0.0.0/0` to allow any address.

`0.0.0.0/0` means the database is reachable from anywhere that has the
password. It is the quick way to get running; the IP list is the right way to
finish.

**Rotate the password before you go live.** The current one was shared in chat,
and a credential that has been shared is a credential that has leaked. Atlas →
**Database Access** → Edit user → **Edit Password**, then update
`MONGODB_URI` in Render.

---

## 2. Render — the API

### Option A: the blueprint (recommended)

The repository already contains `render.yaml`, so Render can configure itself.

1. https://dashboard.render.com → **New** → **Blueprint**
2. Connect `vikky12343/Symplicare-AI-Governance`, branch `main`
3. Render reads `render.yaml` and asks only for the values it must not store
   in a repository. Fill in the three from the table below marked *by hand*.

### Option B: the fields, by hand

**New → Web Service**, connect the same repository, then:

| Field | Value |
| --- | --- |
| Language / runtime | `Node` |
| Branch | `main` |
| Root Directory | *leave empty* — the build must run from the repository root |
| Build Command | `npm ci && npm run build -w @cgi/core && npm run build -w @cgi/api` |
| Start Command | `node apps/api/dist/index.js` |
| Health Check Path | `/api/health` |
| Region | `Frankfurt` — keep UK care data in the EU/UK |
| Instance Type | `Starter` or above (see the note on disks) |

The build command is not optional detail. `@cgi/core` is a workspace package
the API imports; it has to be compiled before the API compiles, and the API has
to be compiled before it starts. Starting the TypeScript sources with `tsx` is
what produced `Cannot find module '@cgi/core/dist/index.js'`.

### Environment variables

Render → your service → **Environment**. Copy the left column exactly.

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |
| `MONGODB_URI` | *by hand* — your Atlas string. Copy the `MONGODB_URI=` line out of `apps/api/.env`, or take a fresh one from Atlas → Connect → Drivers |
| `MONGODB_DB` | `care_governance` |
| `SESSION_SECRET` | *by hand* — generate one, see below |
| `WEB_ORIGIN` | `https://symplicare-ai-governance-frontend.onrender.com` — the site's URL, scheme included, no trailing slash |
| `MAX_UPLOAD_BYTES` | `5242880` |
| `LOG_LEVEL` | `info` |
| `STORAGE_DIR` | `/var/data/evidence` |
| `SCANNER` | *by hand* — read the note below before choosing |

Generate the session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Do **not** set `PORT`. Render assigns one and the API reads it.

### The scanner decision

The API refuses to start in production on the placeholder malware scanner. That
refusal is deliberate — an upload path that nobody scans should not reach
production because somebody forgot. Two honest ways forward:

- **Proper scanning.** Run clamd somewhere Render can reach and set
  `CLAMAV_HOST` to its hostname (leave `SCANNER` unset).
- **Accept the placeholder.** Set `SCANNER=heuristic-accepted-risk`. Uploads
  are still checked structurally and still fail closed, but this is not
  antivirus. Fine for a pilot with known users; not fine once anyone outside
  your organisation can upload.

### About the disk

`render.yaml` mounts a 5GB disk at `/var/data` and points `STORAGE_DIR` at it.
Evidence files live there. Without a disk they are written to the instance
filesystem, **which Render wipes on every deploy** — the records survive in
MongoDB but the files behind them are gone.

Render disks need a paid instance type. On a free instance, leave `STORAGE_DIR`
unset and treat evidence uploads as temporary until you upgrade.

---

## 3. The web app

Pick one of the two. Both serve the same files; both proxy `/api` to the API.

### Option A: Render (static site)

If you deployed with the blueprint, this service already exists — it is in
`render.yaml` alongside the API. Otherwise, **New → Static Site**, connect the
same repository, then:

| Field | Value |
| --- | --- |
| Branch | `main` |
| Root Directory | *leave empty* |
| Build Command | `npm ci && npm run build -w @cgi/core && npm run build -w @cgi/web` |
| Publish Directory | `apps/web/dist` |

One environment variable, `NODE_VERSION` = `22`, and it only affects the
build. There is nothing else to set: the web app reads no environment at all —
no `VITE_*`, no API base URL — because it calls `/api` on its own origin and
the rewrite below decides where that goes. Nothing secret belongs here either;
a static site's variables are compiled into JavaScript every visitor
downloads.

Then **Redirects/Rewrites**, in this order — the first match wins, so the API
rule has to come first or every `/api` call is answered with the application's
own `index.html`:

| Source | Destination | Action |
| --- | --- | --- |
| `/api/*` | `https://symplicare-ai-governance-backend.onrender.com/api/*` | Rewrite |
| `/*` | `/index.html` | Rewrite |

Both must be **Rewrite**, never Redirect: a redirect changes the browser's URL
to the API hostname, and a `sameSite: strict` cookie stops coming back from
there — sign-in appears to work and then every page says signed out.

The second rule is what makes client-side routing work. Without it the site
loads from the home page and every deep link — `/sign-in`, `/dashboard` — is a
404, including on refresh.

There is nothing else to set. The web app holds no secrets — it talks to
`/api` on its own origin and the browser holds the session cookie.

### Option B: Vercel

The repository contains `vercel.json`, so there is nothing to configure by
hand. In the project settings, check:

| Field | Value |
| --- | --- |
| Framework Preset | `Other` |
| Root Directory | *leave empty* — **if this says `apps/api`, clear it**; that is what made the first build fail |
| Build Command | from `vercel.json` — leave the override off |
| Output Directory | from `vercel.json` — leave the override off |

For the record, `vercel.json` sets:

```
build:  npm run build -w @cgi/core && npm run build -w @cgi/web
output: apps/web/dist
```

No environment variables are needed. The web app has no secrets in it — it
talks to `/api` on its own origin and the browser holds the session cookie.

---

## 4. Connect the two

You now have two URLs. Say they are:

```
API   https://symplicare-ai-governance-backend.onrender.com
Web   https://symplicare-ai-governance-frontend.onrender.com          (or …vercel.app)
```

**a. Tell the API which site may call it.** Render → *symplicare-api* →
Environment →

```
WEB_ORIGIN = https://symplicare-ai-governance-frontend.onrender.com
```

CORS refuses every other origin. Scheme included, no trailing slash. If you
also want Vercel preview deployments to work, list them comma-separated:

```
WEB_ORIGIN = https://symplicare-ai-governance-frontend.onrender.com,https://symplicare-ai-governance.vercel.app
```

**b. Tell the site where the API is.**

*On Render:* the static site → **Redirects/Rewrites** → the `/api/*` rule →
set the destination to `https://symplicare-ai-governance-backend.onrender.com/api/*`. Save, then
redeploy the static site. (If you used the blueprint, edit the destination in
`render.yaml` and push instead — that keeps the file and the dashboard
agreeing.)

*On Vercel:* edit `vercel.json`, with the API rule **above** the SPA fallback
because the first match wins:

```json
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://symplicare-ai-governance-backend.onrender.com/api/:path*" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
```

```bash
git add vercel.json && git commit -m "Point the API rewrite at Render" && git push
```

Vercel redeploys on the push.

---

## 5. Check it works

```bash
curl https://symplicare-ai-governance-backend.onrender.com/api/health
```

```bash
curl https://symplicare-ai-governance-frontend.onrender.com/api/health
```

Both must return the same JSON. The first proves the API is up; the second
proves the rewrite reaches it, which is the half that actually matters.

Then open the site itself and reload on a deep link — `/dashboard`, say. A 404
there means the catch-all rewrite to `index.html` is missing or is sitting
above the `/api` rule.

Then open the site, create an account, and complete onboarding. There is a
sample sheet to upload in `samples/` — generate one for your care home's code
with:

```bash
node scripts/make-sample-upload.mjs --code YOUR-HOME-CODE --name "Your Home"
```

---

## When it goes wrong

| What you see | What it means |
| --- | --- |
| `Cannot find module '@cgi/core/dist/index.js'` | The build did not compile the core package, or the start command is running `src` instead of `dist`. Check both commands in section 2. |
| Build fails with dozens of `TS2307` / implicit `any` | The same thing, at compile time. Every one of those errors is downstream of the missing core package. |
| `Failed to start` with `MongooseServerSelectionError` | Atlas is refusing the connection. Section 1. |
| API starts, then exits complaining about the scanner | `SCANNER` / `CLAMAV_HOST` is unset. Section 2. |
| Site loads, sign-in says the API is not running | The `/api` rewrite is missing or points at the wrong host. Section 4b. |
| `/dashboard` reloads to a 404, but the site works from the home page | The catch-all rewrite to `/index.html` is missing. Section 3. |
| Every `/api` call returns the page's own HTML | The catch-all is matching first. The `/api` rule must be above it. |
| Sign-in succeeds, then every page says signed out | The session cookie is being dropped. The site must call `/api` on its own origin through the rewrite — never the Render hostname directly. |
| CORS errors in the browser console | `WEB_ORIGIN` does not match the site's hostname exactly, scheme included. |
| First request after a quiet period takes ~30s | A free Render instance sleeping. Upgrade the instance, or live with it. |
| Evidence files vanish after a deploy | No disk mounted. Section 2. |
