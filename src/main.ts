import './styles.css';
import { parseConfig, type AppConfig } from './config';
import { SimulationEngine } from './sim/engine';
import { Dashboard } from './ui/Dashboard';
import { DebugOverlay } from './ui/DebugOverlay';

/** UI refresh rate. Text and status do not need more on a wall display. */
const TICK_MS = 100;
/** Largest real-time step simulated per tick; longer gaps (suspension, frozen tab) are dropped. */
const MAX_STEP_MS = 1000;
/** Display timestamps are re-anchored to the wall clock when they drift further than this. */
const CLOCK_DRIFT_MS = 2000;
/** More crashes than this within CRASH_WINDOW_MS gives up and reloads the page. */
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 10 * 60_000;

const cfg = parseConfig(location.search);
const reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
const started = performance.now();

let engine: SimulationEngine;
let dashboard: Dashboard;
let mounted: HTMLElement = document.getElementById('app') as HTMLElement;
let last = performance.now();
let crashes: number[] = [];
let timer = 0;
let seed = cfg.seed;
const overlay = cfg.debug ? new DebugOverlay() : null;

function boot(): void {
  engine = new SimulationEngine({ seed, agents: cfg.agents }, Date.now() - cfg.warmupMs);
  engine.advance(cfg.warmupMs);
  dashboard = new Dashboard(engine, cfg, reducedMotion);
  mounted.replaceWith(dashboard.el);
  mounted = dashboard.el;
  // Measure after the first render so rows have their real content.
  dashboard.render(Date.now(), performance.now() - started);
  dashboard.layout();
  last = performance.now();
}

/**
 * Keeps log timestamps in step with the wall clock. Simulated time pauses while the tab is
 * hidden and the system clock can jump (NTP sync after boot on a Pi without RTC), so the
 * anchor is moved forward when display time falls behind, or back after a large backward jump.
 */
function syncClock(c: AppConfig): void {
  const drift = Date.now() - (engine.clockBase + engine.now);
  if (drift > CLOCK_DRIFT_MS || (c.speed === 1 && drift < -60_000)) engine.clockBase += drift;
}

function tick(): void {
  const now = performance.now();
  if (document.hidden) {
    // Paused while hidden; on return we continue from here instead of replaying the gap.
    last = now;
    return;
  }
  try {
    const dt = Math.min(now - last, MAX_STEP_MS);
    last = now;
    const t0 = performance.now();
    engine.advance(dt * cfg.speed);
    syncClock(cfg);
    dashboard.render(Date.now(), now - started);
    if (overlay) overlay.update(engine, cfg, performance.now() - t0);
  } catch (err) {
    recover(err);
  }
}

/** Error boundary: a simulation or render fault restarts the dashboard instead of blanking it. */
function recover(err: unknown): void {
  console.error('[control-center] recovering from error', err);
  const now = Date.now();
  crashes = crashes.filter((t) => now - t < CRASH_WINDOW_MS);
  crashes.push(now);
  if (crashes.length > MAX_CRASHES) {
    showFallback();
    return;
  }
  try {
    // A different seed avoids replaying straight into the same fault.
    seed++;
    boot();
  } catch (bootErr) {
    console.error('[control-center] restart failed', bootErr);
    showFallback();
  }
}

let fallbackShown = false;
function showFallback(): void {
  if (fallbackShown) return;
  fallbackShown = true;
  clearInterval(timer);
  const box = document.createElement('div');
  box.className = 'boot';
  box.textContent = 'AGENT CONTROL CENTER · restarting…';
  mounted.replaceWith(box);
  mounted = box;
  setTimeout(() => location.reload(), 60_000);
}

window.addEventListener('error', (e) => console.error('[control-center] uncaught', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[control-center] unhandled rejection', e.reason));

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    try {
      dashboard.layout();
    } catch (err) {
      recover(err);
    }
  }, 250);
});

document.addEventListener('visibilitychange', () => {
  last = performance.now();
});

if (cfg.reloadHours > 0) setTimeout(() => location.reload(), cfg.reloadHours * 3_600_000);

try {
  boot();
} catch (err) {
  recover(err);
}
if (overlay) document.body.append(overlay.el);
timer = window.setInterval(tick, TICK_MS);
tick();
