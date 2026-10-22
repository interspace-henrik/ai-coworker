import './styles.css';
import { defaultConfig } from './config';
import { SimulationEngine } from './sim/engine';
import { Dashboard } from './ui/Dashboard';

/** UI refresh rate. Text and status do not need more on a wall display. */
const TICK_MS = 100;
/** Largest simulated step taken per tick; longer gaps (suspension, hidden tab) are dropped. */
const MAX_STEP_MS = 1000;

const cfg = defaultConfig();
const started = performance.now();
const engine = new SimulationEngine({ seed: cfg.seed, agents: cfg.agents }, Date.now() - cfg.warmupMs);
engine.advance(cfg.warmupMs);

const dashboard = new Dashboard(engine, cfg);
const root = document.getElementById('app') as HTMLElement;
root.replaceWith(dashboard.el);
dashboard.layout();
window.addEventListener('resize', () => dashboard.layout());

let last = performance.now();
function tick(): void {
  const now = performance.now();
  const dt = Math.min(now - last, MAX_STEP_MS);
  last = now;
  engine.advance(dt * cfg.speed);
  dashboard.render(Date.now(), now - started);
}
tick();
setInterval(tick, TICK_MS);
