import type { SimulationEngine } from '../sim/engine';
import { el, fmtClock, fmtDate, fmtUptime, setClass, setText } from './dom';

export class Header {
  readonly el = el('header', 'hdr');
  private status = el('span', 'pill-text');
  private pill = el('div', 'pill ok');
  private agents = el('span', 'hdr-stat-v');
  private clock = el('div', 'clock');
  private date = el('div', 'clock-sub');
  private uptime = el('span');

  constructor() {
    const brand = el('div', 'brand');
    const mark = el('div', 'brand-mark');
    mark.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5"/><rect x="14" y="2" width="8" height="8" rx="1.5" class="m2"/><rect x="2" y="14" width="8" height="8" rx="1.5" class="m2"/><rect x="14" y="14" width="8" height="8" rx="1.5"/></svg>';
    const names = el('div');
    names.append(el('div', 'brand-name', 'AGENT CONTROL CENTER'), el('div', 'brand-sub', 'Orchestrator · eu-north-1'));
    brand.append(mark, names);

    this.pill.append(el('span', 'pill-dot'), this.status);
    const mid = el('div', 'hdr-mid');
    const agentStat = el('div', 'hdr-stat');
    agentStat.append(el('span', 'hdr-stat-k', 'Agents'), this.agents);
    mid.append(this.pill, agentStat);

    const right = el('div', 'hdr-right');
    const up = el('div', 'clock-sub');
    up.append('Uptime ', this.uptime);
    const clockBox = el('div', 'clock-box');
    clockBox.append(this.clock, this.date, up);
    right.append(clockBox);

    this.el.append(brand, mid, right);
  }

  update(engine: SimulationEngine, wallNow: number, uptimeMs: number): void {
    setText(this.status, 'ALL SYSTEMS OPERATIONAL');
    setClass(this.pill, 'pill ok');
    setText(this.agents, engine.activeAgents() + ' / ' + engine.agents.length + ' active');
    setText(this.clock, fmtClock(wallNow));
    setText(this.date, fmtDate(wallNow));
    setText(this.uptime, fmtUptime(uptimeMs));
  }
}
