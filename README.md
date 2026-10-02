# ENVOY — Autonomous AI Operator

**The autonomous AI operator that exits the chat and drives your apps.**

ENVOY takes a natural-language command and executes the entire multi-app workflow inside real browsers — via Playwright automation, MCP servers, and native tools. It verifies every action, auto-recovers from failures, and pauses for human sign-off before any irreversible step.

Built for **PS-01: Autonomous Agents for Everyday Apps** at BFWAI/HACK 26.

Live Demo: [https://envoy-s94a.onrender.com/dashboard](https://envoy-s94a.onrender.com/dashboard)

---

## Table of Contents

- Why ENVOY
- Core Capabilities
- Architecture
- Tech Stack
- Quick Start
- Environment Variables
- Usage Examples
- MCP Integrations
- Scheduled Tasks
- Human-in-the-Loop Safety
- Live Browser Streaming
- Deployment
- Project Structure
- Evaluation Metrics
- Team
- License

---

## Why ENVOY

Chatbots tell users **what** to do. They don't **do** it.

Knowledge workers still copy-paste across CRMs, dashboards, spreadsheets, portals, and email. Every workflow involves:

- Repetitive clicks instead of decisions
- Context switching between disconnected apps
- Error-prone copy-paste across tools
- Internal portals with no APIs
- AI that recommends but doesn't execute

**ENVOY closes that loop.** You describe the outcome. It handles the clicking — safely, transparently, and accountably.

---

## Core Capabilities

- **Natural-language input** — One sentence = one mission. No scripts, no selectors, no configuration.
- **Autonomous multi-step planning** — Gemini-powered planner breaks goals into atomic executable steps.
- **Real browser operation** — Drives real Chromium via Playwright, not a mock environment.
- **Any website** — LLM-driven element finder handles pages without hardcoded selectors.
- **Human-in-the-loop safety** — Pauses for approval before passwords, payments, sends, submits, deletes.
- **Captcha handling** — Detects captchas, pauses, and auto-resumes when solved.
- **Self-healing** — Detects failures, replans with Gemini, retries, or aborts cleanly.
- **Live progress streaming** — Screencast of the live browser inside your dashboard.
- **Full audit trail** — Every action logged with timestamps, screenshots, and results.
- **Scheduled tasks** — "Tomorrow at 9am, do X" — job runs unattended.
- **Excel generation** — Creates .xlsx files from natural language.
- **MCP integration** — Extensible via any Model Context Protocol server.

---

## Architecture

text

```
User prompt
    |
Planner (Gemini) -> structured step list
    |
Executor + Verifier -> retries, replans, gates
    |
    +-- Browser (Playwright + LLM element finder)
    +-- MCP servers (filesystem, excel)
    +-- Native tools (Excel, schedule)
    |
CDP Screencast -> SSE -> Live View
Approval + Captcha + Credential gates
```

svgsvg

Components:

- **Planner** — Gemini gemini-3.1-flash-lite converts the prompt into ordered steps. Falls back to a rule-based planner if the API is unavailable.
- **Executor** — runs steps sequentially, checks a cancellation flag between steps, invokes the replanner on failure.
- **Verifier** — validates step outcomes (URL change, element presence, extracted data).
- **Replanner** — asks Gemini for a revised plan when a step fails, with credential context preserved.
- **Risk Engine** — flags sensitive actions (login, payment, delete) for approval.
- **Browser Tool** — persistent Chromium via Playwright with LLM element finder, captcha detection, SSO redirect handling, choose-account screen handling, multi-strategy click fallback.
- **Scheduler** — in-process heartbeat checking for due jobs every 30 seconds. Persists to disk. Auto-cleans stale jobs.
- **Live Stream** — CDP screencast streamed over SSE. Interactive clicks and keystrokes forwarded back to Chromium.

---

## Tech Stack

| **Layer**  | **Technology**                         |
| :--------- | :------------------------------------- |
| Framework  | Next.js 14 (App Router)                |
| Language   | TypeScript                             |
| UI         | Tailwind CSS + custom dark theme       |
| State      | Zustand                                |
| Browser    | Playwright (Chromium) + CDP screencast |
| LLM        | Google Gemini (@google/genai)          |
| MCP        | @modelcontextprotocol/sdk              |
| Excel      | ExcelJS                                |
| Scheduler  | node-cron + custom heartbeat           |
| Deployment | Render (Docker) / Local                |

---

## Quick Start

Prerequisites:

- Node.js 18.17+ (Node 20 recommended)
- A Google Gemini API key — free at [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

Installation:

text

```
git clone https://github.com/SapkalAryan/Envoy.git
cd Envoy
npm install
npx playwright install chromium
cp .env.example .env.local
```

svgsvg

Configure .env.local:

text

```
GEMINI_API_KEY=AIza...your-key...
GEMINI_MODEL=gemini-3.1-flash-lite
BROWSER_HOLD_MS=3000
```

svgsvg

Run:

text

```
npm run dev
```

svgsvg

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

---

## Environment Variables

| **Variable**    | **Required** | **Description**                                  |
| :-------------- | :----------- | :----------------------------------------------- |
| GEMINI_API_KEY  | Yes          | Google Gemini API key                            |
| GEMINI_MODEL    | Optional     | Model ID (default: gemini-3.1-flash-lite)        |
| HEADLESS        | Optional     | Set true to hide the browser                     |
| RENDER          | Optional     | Set true when deploying on Render                |
| BROWSER_HOLD_MS | Optional     | Milliseconds to hold window open after each step |

---

## Usage Examples

YouTube search + play:

text

```
go to youtube.com and search for fein by travis scott and play the 2nd video
```

svgsvg

E-commerce search + add to cart:

text

```
go to amazon.in and search for oneplus nord ce 4 phone cover and add the first one to cart
```

svgsvg

Login with approval + captcha:

text

```
go to instagram.com and log in with username sapkal_93 password as93A23_XM8
```

svgsvg

Any website with no hardcoded selectors:

text

```
go to flipkart.com and search for kurtas
```

svgsvg

Excel creation:

text

```
create an excel sheet named leads.xlsx with columns Name, Email, Phone and add 3 rows: John/john@x.com/555-0100, Jane/jane@x.com/555-0200, Bob/bob@x.com/555-0300
```

svgsvg

Scheduled task:

text

```
tomorrow at 9am, go to youtube.com and search for tmkoc
```

svgsvg

Multi-step with "then":

text

```
go to youtube.com, search for lofi beats, then go to google.com and search for nextjs
```

svgsvg

MCP filesystem:

text

```
use mcp filesystem to list files in D:\Projects
```

svgsvg

---

## MCP Integrations

ENVOY talks to any MCP server listed in config/mcp-servers.json.

Preconfigured: filesystem, excel.

Add your own:

text

```
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

svgsvg

Then reference it in a prompt:

text

```
use mcp github to create an issue titled "Test from ENVOY"
```

svgsvg

---

## Scheduled Tasks

Jobs are stored in data/scheduled-jobs.json and survive restarts.

| **Phrase**               | **Behavior**                |
| :----------------------- | :-------------------------- |
| in 30 minutes, ...       | Runs once, 30 min from now  |
| in 2 hours, ...          | Runs once, 2 hours from now |
| tomorrow at 9am, ...     | Runs once, tomorrow 09:00   |
| tonight at 8pm, ...      | Runs once, today at 20:00   |
| every day at 7am, ...    | Recurring daily at 07:00    |
| every monday at 9am, ... | Recurring weekly            |
| every hour, ...          | Recurring hourly            |

Management:

- View jobs in the dashboard sidebar
- Cancel any pending job with one click
- Clear done removes completed and failed jobs immediately
- Auto-cleanup removes completed once-jobs 1 hour after completion

---

## Human-in-the-Loop Safety

ENVOY pauses for explicit user approval before any:

- Login or registration
- Form submission
- Sending email or messages
- Payment or checkout
- Deletion or irreversible action

The approval modal appears in the dashboard. The browser window focuses back to the console, waits for the decision, then refocuses the browser to continue.

Captcha handling:

1. Agent detects captcha (URL pattern + DOM elements + text)
2. Modal appears with a live timer
3. User clicks "Open Browser Tab" — Chromium focuses
4. User solves the captcha
5. Agent auto-detects the solve (polls the page) and resumes — no button click required

---

## Live Browser Streaming

Because headless Chromium has no visible window on servers, ENVOY streams the browser into a dedicated dashboard tab using CDP screencast over SSE.

- Every mission opens a new tab at /live/\<missionId>
- Live view shows the real Chromium rendering at 2-10 fps
- Clicks, keystrokes, and scrolls are forwarded back to Chromium
- Shareable URL — send /live/mission_xyz to a colleague

This is the same pattern used by ChatGPT Operator, Browserbase, and [Steel.dev](https://steel.dev/).

---

## Deployment

### Render (recommended)

Steps:

1. Push to GitHub
2. Create a Web Service on [https://render.com](https://render.com/)
3. Runtime: Docker
4. Instance: Starter ($7/month) — Free tier OOMs on Chromium
5. Add env vars: GEMINI_API_KEY, GEMINI_MODEL, HEADLESS=true, RENDER=true, NODE_ENV=production
6. Attach a Persistent Disk mounted at /data (1 GB)
7. Health check path: /api/health
8. Deploy

The Dockerfile installs Chromium and all system dependencies.

### Railway / [Fly.io](https://fly.io/)

Same Dockerfile works. Attach a persistent volume at /data.

### Vercel

Vercel cannot run this because it lacks:

- Persistent browser sessions
- Long-running schedulers
- Chromium system dependencies

You can deploy the UI shell, but browser automation and scheduling will not work.

---

## Project Structure

text

```
envoy-agent/
  app/
    dashboard/page.tsx
    live/[missionId]/page.tsx
    api/
      agent/
        execute/route.ts
        approve/route.ts
        stream/route.ts
        interact/route.ts
        stop/route.ts
        status/route.ts
        focus-browser/route.ts
      scheduler/route.ts
      health/route.ts
  components/
    CommandInput.tsx
    PlanViewer.tsx
    AgentTimeline.tsx
    ApprovalModal.tsx
    AuditLog.tsx
    LiveBrowser.tsx
    ScheduledJobs.tsx
    OpenLiveButton.tsx
  lib/
    agent/
      planner.ts
      llmPlanner.ts
      executor.ts
      verifier.ts
      replanner.ts
      riskEngine.ts
      memory.ts
      observer.ts
    llm/
      geminiClient.ts
    scheduler/
      index.ts
      store.ts
      cleanup.ts
    tools/
      browser.ts
      browserStream.ts
      browserElementFinder.ts
      mcpClient.ts
      excelTool.ts
      scheduleTool.ts
      apiConnector.ts
      registry.ts
  config/
    mcp-servers.json
  data/
  Dockerfile
  next.config.js
  README.md
```

svgsvg

---

## Evaluation Metrics

| **Metric**            | **Target** | **How Measured**                                           |
| :-------------------- | :--------- | :--------------------------------------------------------- |
| Task pass rate        | >= 90%     | Missions completing all steps across a 20-prompt benchmark |
| Verification accuracy | > 95%      | Steps whose stated outcome matches the actual DOM          |
| Recovery rate         | > 80%      | Failures resolved automatically without user intervention  |
| Execution time        | <= 5 min   | Per representative multi-step mission vs 30 min manual     |
| Audit completeness    | 100%       | Every step logged with timestamps, screenshots, results    |

Run the benchmark:

text

```
node scripts/bench.mjs
```

svgsvg

---

## Team

**CogniVerse** — AC Patil College of Engineering, Navi Mumbai

| **Member**   | **Role**                                  |
| :----------- | :---------------------------------------- |
| Rohit Sawant | AI Agent and Full Stack Developer         |
| Aryan Sapkal | AI/Automation and Browser Agent Developer |
| Soham Raul   | Backend and Systems Integration Developer |

---

## License

MIT License — see LICENSE for details.

---

## Acknowledgments

- Built for **BFWAI/HACK 26** — Problem Statement **PS-01: Autonomous Agents for Everyday Apps**
- Powered by Google Gemini, Playwright, and Model Context Protocol
- Inspired by Anthropic Computer Use and OpenAI Operator

---

ENVOY — You define the outcome. It handles the clicking.