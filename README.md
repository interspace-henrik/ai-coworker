# Agent Control Center

A static web app that simulates a control room where many AI agents work in parallel. It is
built for an information screen: open the URL and it runs by itself, indefinitely. Everything
is simulated in the browser — no backend, no API calls and no network traffic after the page
has loaded. All project names, hosts and data in the logs are synthetic.

The original specification is in [ai-agent-control-center-handover.md](ai-agent-control-center-handover.md).

## Run and build

```sh
npm install
npm run dev       # local dev server
npm test          # engine, template, config, determinism and 24 h soak tests
npm run build     # type check + static build in dist/
npm run preview   # serve dist/ locally
```

`dist/` uses relative paths, so it can be served from any directory on any static web server.

## Deploy

Every push to `main` tests, builds and deploys to GitHub Pages via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml), on the custom domain in
[CNAME](CNAME). One-time setup: in the repository settings, under **Pages**, set **Source** to
**GitHub Actions**.

## URL parameters

| Parameter       | Default   | Effect                                                                 |
| --------------- | --------- | ---------------------------------------------------------------------- |
| `agents=40`     | `30`      | Number of agents (8–100).                                              |
| `seed=1234`     | random    | Fixed seed: the same seed and settings replay the same scenario.       |
| `speed=1.5`     | `1`       | Simulated seconds per real second (0.1–100), for demos and testing.    |
| `density=high`  | `normal`  | Terminal panels: `low` = 4, `normal` = 6, `high` = 9.                  |
| `debug=1`       | off       | Diagnostics overlay: seed, simulated time, tick cost, DOM nodes, heap. |
| `reload=24`     | off       | Reload the page every N hours, as extra safety on 24/7 screens.        |

Invalid values fall back to defaults and out-of-range values are clamped.

## Yodeck (Raspberry Pi 4)

Add the URL as a **Web Page** app and put it in a playlist or schedule. The page autostarts,
fills the viewport (16:9 primarily; any size works, layout scales with the screen) and hides
the cursor. The player has no keyboard, so all configuration is through the URL.

Performance budget for the Pi: the UI updates at most 10 times per second and only touches
DOM nodes whose content changed; no blur, shadows or filters; the agent list rotates in short
transform glides rather than a perpetual animation, and cursor blink is a class toggle. The
DOM is a fixed set of about 1,350 nodes for the whole session.

## How it works

```
src/
  sim/                 simulation, no DOM, deterministic
    engine.ts          SimulationEngine: agents, tasks, central event-heap scheduler,
                       load level, rare events, KPIs and history
    templates.ts       71 task templates with coherent log sequences, failures, fixes
    template.ts        placeholder resolution ({table}, {n:20-80}, …) and line parsing
    vocab.ts           synthetic names used in titles and logs
    prng.ts            seedable PRNG (mulberry32)
    heap.ts            min-heap ordered by (time, sequence)
    ringbuffer.ts      fixed-capacity buffers for logs, events, history
  ui/                  renders a snapshot of engine state; holds no simulation logic
    Dashboard.ts       layout and render loop wiring
    Header, AgentList, TerminalGrid, Metrics, ActivityChart, TaskQueue, EventFeed,
    DebugOverlay
  config.ts            URL parameters
  main.ts              boot, tick loop, error boundary, visibility and clock handling
```

- **Scheduler.** One min-heap of timed events (agent steps, arrivals, samples, load shifts,
  rare events) drives everything; there is no timer per agent or log line. Simulated time
  advances by real elapsed time × `speed` on each 100 ms tick.
- **Agents** follow `idle → assigned → analyzing → planning → executing → validating →
  completed`. Validation can fail into `retrying` (back to `executing`, up to 3 attempts) or
  `failed`; either way the agent is released. Some tasks fan out subtasks to other agents and
  wait for them (with a timeout), shown as `WAITING`.
- **Variation.** A load level drifts between calmer and busier periods every 1–3 minutes and
  drives arrival rate and pace. Every few minutes a batch window, inbound surge or incident
  (with recovery) occurs.
- **KPIs** are computed from engine state: active agents, completed, queue depth, success
  rate from finished tasks, throughput over the last 60 s, real retry count.
- **Determinism.** Given the same seed and config the event sequence is identical regardless
  of how time is chopped into ticks (covered by a test). Wall-clock timestamps in the logs are
  display only.
- **Long-running.** Every collection is bounded (queue, logs, recent tasks, events, history,
  event heap). Hidden tabs pause the simulation and resume without replaying the gap; gaps over
  1 s are dropped. Log timestamps re-anchor to the wall clock after pauses or system clock
  jumps (a Pi without an RTC jumps at NTP sync). A simulation or render error restarts the
  dashboard; repeated errors show a holding screen and reload after a minute.

## Verification

- `npm test` covers state transitions, KPI accounting, retry/failure/subtask rates, the
  5-minute history window, load variation, template integrity, URL parsing, seed
  determinism and a simulated 24-hour run with 50 agents asserting bounded collections.
- In a browser at `?speed=100&debug=1` (four simulated hours) the DOM stayed at a constant
  1,353 nodes and the JS heap levelled off around 2 MB after GC.
