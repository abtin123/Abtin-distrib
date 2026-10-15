# v2panel

Cloudflare Worker: VLESS+WS+TLS, user panel (`/panel`), subscription (`/sub/<uuid>`), AI assistant.

## Deploy
1. Fork/push to GitHub.
2. Repo → Settings → Secrets → Actions: `CLOUDFLARE_API_TOKEN` (Edit Workers template), `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_PASSWORD`.
3. Push to `main` (or run the `deploy` workflow).
4. Open `https://v2panel.<subdomain>.workers.dev/panel`.

Manual: `npx wrangler deploy && npx wrangler secret put ADMIN_PASSWORD`.

Dashboard paste: create Worker, paste `worker.js`, add KV binding `DB`, optional AI binding `AI`, secret `ADMIN_PASSWORD`.
