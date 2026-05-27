# Library Lending System

A combined frontend and backend workspace for a small library lending app.

- Frontend: Next.js in `apps/web`
- Backend: NestJS in `apps/api`
- Package manager: pnpm workspaces

## Run locally

```bash
cp .env.example .env
pnpm install
pnpm dev
```

The API runs on `http://localhost:3001` and the web app runs on `http://localhost:3000`.

Set `LIBRARIAN_EMAIL` and `LIBRARIAN_PASSWORD` in `.env` before using librarian login.

## Useful scripts

```bash
pnpm dev:api
pnpm dev:web
pnpm build
pnpm lint
pnpm typecheck
```

## Deploy to Vercel

Create two Vercel projects from this GitHub repo.

### API project

- Root Directory: `apps/api`
- Framework Preset: Other
- Install Command: `cd ../.. && pnpm install --frozen-lockfile`
- Build Command: `pnpm build`
- Output Directory: leave empty

Environment variables:

```bash
WEB_ORIGIN=https://<your-web-project>.vercel.app
LIBRARIAN_EMAIL=<librarian-email>
LIBRARIAN_PASSWORD=<strong-password>
```

After deployment, the API base URL will be the API project URL, for example
`https://<your-api-project>.vercel.app`.

### Web project

- Root Directory: `apps/web`
- Framework Preset: Next.js
- Install Command: `cd ../.. && pnpm install --frozen-lockfile`
- Build Command: `pnpm build`

Environment variables:

```bash
NEXT_PUBLIC_API_URL=https://<your-api-project>.vercel.app
```

The API uses httpOnly cookies. In production it sets `SameSite=None; Secure`, so the API
and web Vercel domains can work together as long as `WEB_ORIGIN` exactly matches the web URL.
