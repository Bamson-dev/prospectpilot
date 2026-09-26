# ProspectPilot

ProspectPilot discovers companies, researches public websites, qualifies opportunities with DeepSeek, and holds outreach for approval before Resend or Gmail can send it.

## Local

Copy `.env.example` to a gitignored `.env` and set `AUTH_SECRET`.

```bash
docker compose up db redis -d
npm install
npx prisma migrate deploy
npm run dev
npm run worker
```

The web app listens on port 3000. Workers use Redis and must run as a separate process.

## Production

`Dockerfile` serves the Next.js app. `Dockerfile.worker` runs the BullMQ workers and Playwright. Postgres and Redis are separate services. Do not commit real credentials.

Health: `GET /api/health`. Readiness, including Redis: `GET /api/health?ready=1`.
