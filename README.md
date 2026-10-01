# ENVOY — Autonomous AI Operator

> The autonomous AI operator that exits the chat and drives your apps.

ENVOY is an autonomous agent that takes a natural-language command and executes the full
multi-app workflow via browser automation, MCP, and REST APIs. It verifies every action in
real time, auto-recovers from failures, and pauses for human sign-off before any
irreversible step.

## Stack

- **Next.js 14** (App Router) + TypeScript
- **Tailwind CSS** for the dark operator console
- **Zustand** for local agent state
- **OpenAI** for goal understanding, verification, and recovery reasoning
- **Playwright + @sparticuz/chromium** (optional) for real browser automation

## Local development

```bash
npm install
cp .env.example .env.local
# add OPENAI_API_KEY
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo at https://vercel.com/new.
3. Add environment variable `OPENAI_API_KEY` in Project Settings → Environment Variables.
4. Deploy. The `vercel.json` config sets function timeouts for the agent routes.

## API

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/agent/plan` | Generate a mission plan from a prompt |
| POST | `/api/agent/execute` | Plan + execute a mission end-to-end |
| GET | `/api/agent/status?id=` | Get mission status (or list all) |
| GET | `/api/workflows` | List saved workflows |
| GET | `/api/workflows/:id` | Get a workflow by id |
| GET | `/api/health` | Health check |

## Architecture

```
User Input → Goal Engine → Planner → Tool Router → Execution Engine
                                ↓
        Observer → Verifier → Recovery Agent → Risk Engine
                                ↓
        Mission Memory & State → Audit & Logging → Output
```

## Team — CogniVerse

- **Rohit Sawant** — AI Agent & Full Stack Developer
- **Aryan Sapkal** — AI/Automation & Browser Agent Developer
- **Soham Raul** — Backend & Systems Integration Developer

AC Patil College of Engineering, Navi Mumbai.