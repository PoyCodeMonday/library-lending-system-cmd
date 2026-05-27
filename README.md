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
Set `DATABASE_URL` to a Postgres database before running migrations or the API.

## Useful scripts

```bash
pnpm dev:api
pnpm dev:web
pnpm db:migrate:dev
pnpm db:migrate:deploy
pnpm db:seed
pnpm build
pnpm lint
pnpm typecheck
```

## Database

This app uses Postgres through Prisma. Do not edit production tables manually.
All schema changes should be committed as Prisma migrations under `apps/api/prisma/migrations`.

Development:

```bash
pnpm db:migrate:dev
pnpm db:seed
```

Production/Vercel:

```bash
pnpm db:migrate:deploy
pnpm db:seed
```

The seed script is idempotent and inserts baseline rows for every table:
`books`, `members`, `sessions`, and `loans`.

## Deploy to Vercel

Create two Vercel projects from this GitHub repo.

Create a Vercel Postgres database first, then copy its `DATABASE_URL` into the
API project's environment variables. The API project build command runs:

```bash
pnpm db:migrate:deploy && pnpm db:seed && pnpm build
```

That means every production deployment applies committed migrations first, then
runs the idempotent seed script.

### API project

- Root Directory: `apps/api`
- Framework Preset: Other
- Install Command: `cd ../.. && pnpm install --frozen-lockfile`
- Build Command: `pnpm build`
- Output Directory: leave empty

Environment variables:

```bash
WEB_ORIGIN=https://<your-web-project>.vercel.app
DATABASE_URL=postgresql://...
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
