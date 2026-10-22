# Agent Control Center

A static web app that simulates a control room where many AI agents work in parallel. It is
meant for an information screen: open the URL and it runs by itself. Everything is simulated
in the browser — no backend, no API calls and no network traffic after the page has loaded.

The full specification is in [ai-agent-control-center-handover.md](ai-agent-control-center-handover.md).

## Run and build

```sh
npm install
npm run dev       # local dev server
npm test          # simulation engine tests
npm run build     # static build in dist/
npm run preview   # serve dist/ locally
```

`dist/` uses relative paths, so it can be served from any directory on any static web server.

## Deploy

Every push to `main` builds, tests and deploys to GitHub Pages via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml). One-time setup: in the repository
settings, under **Pages**, set **Source** to **GitHub Actions**.
