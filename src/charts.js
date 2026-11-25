// Small dependency-free SVG chart layer: synced crosshair line charts and a dose timeline.
// All label text is inserted with textContent.

const SVGNS = 'http://www.w3.org/2000/svg';
export const CHART_MARGIN = { left: 50, right: 46 };

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}
function svgText(parent, x, y, str, attrs = {}) {
  const t = svgEl('text', { x, y, ...attrs }, parent);
  t.textContent = str;
  return t;
}

export function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return { ticks, step };
}

export function fmtNum(v, digits) {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  const d = digits ?? (a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.1 ? 2 : 3);
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtPct(rel) {
  const p = rel * 100;
  if (p >= 10) return p.toFixed(0) + '%';
  if (p >= 1) return p.toFixed(1) + '%';
  if (p >= 0.01) return p.toFixed(2) + '%';
  return '<0.01%';
}
function fmtDay(d) {
  return 'Day ' + (Math.abs(d - Math.round(d)) < 1e-6 ? Math.round(d) : d.toFixed(2));
}

/** Shared hover state so every chart shows the crosshair at the same day. */
export function createHub(tooltipEl) {
  const charts = new Set();
  return {
    register(c) { charts.add(c); },
    reset() { charts.clear(); },
    setToday(day) { for (const c of charts) c.today?.(day); },
    unregister(c) { charts.delete(c); },
    show(day, source, clientX, clientY) {
      for (const c of charts) c.crosshair(day);
      const rows = source.readout(day);
      renderTooltip(tooltipEl, fmtDay(day), rows, clientX, clientY);
    },
    hide() {
      for (const c of charts) c.crosshair(null);
      tooltipEl.hidden = true;
    },
  };
}

function renderTooltip(el, head, rows, x, y) {
  el.replaceChildren();
  const h = document.createElement('div');
  h.className = 'tt-head';
  h.textContent = head;
  el.appendChild(h);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tt-row';
    const key = document.createElement('span');
    key.className = 'tt-key' + (r.dash ? ' dash' : '');
    key.style.borderTopColor = r.color || 'transparent';
    const name = document.createElement('span');
    name.className = 'tt-name';
    name.textContent = r.label;
    const val = document.createElement('span');
    val.className = 'tt-val';
    val.textContent = r.value;
    row.append(key, name, val);
    el.appendChild(row);
  }
  el.hidden = false;
  const pad = 14;
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let left = x + pad;
  if (left + w > window.innerWidth - 8) left = x - pad - w;
  let top = y - hgt - pad;
  if (top < 8) top = y + pad;
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = top + 'px';
}

function nearestIndex(t, day) {
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= day) lo = mid;
    else hi = mid;
  }
  return day - t[lo] < t[hi] - day ? lo : hi;
}

function xAxis(g, x, days, top, bottom, w, showLabels = true) {
  const { ticks } = niceTicks(0, days, Math.max(3, Math.min(10, Math.floor(w / 70))));
  for (const v of ticks) {
    const px = x(v);
    svgEl('line', { x1: px, x2: px, y1: top, y2: bottom, stroke: 'var(--grid)', 'stroke-width': 1 }, g);
    if (showLabels) svgText(g, px, bottom + 14, String(v), { class: 'tick', 'text-anchor': 'middle' });
  }
}

/**
 * Line chart with optional thresholds, comparison series, observations, and log scale.
 * opts: { t, series:[{label,color,values,dash}], title, unit, log, yMinRel, thresholds, points, height, days, hub, format }
 */
export function lineChart(el, opts) {
  el.replaceChildren();
  const width = Math.max(280, el.clientWidth || 600);
  const height = opts.height || 210;
  const m = { top: 30, bottom: 26, ...CHART_MARGIN };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' }, el);
  svg.setAttribute('aria-label', opts.ariaLabel || opts.title);
  const days = opts.days ?? opts.t[opts.t.length - 1];
  const x = (d) => m.left + (d / days) * iw;
  const format = opts.format || ((v) => fmtNum(v));

  // Y domain
  const all = [];
  for (const s of opts.series) for (const v of s.values) if (Number.isFinite(v)) all.push(v);
  for (const p of opts.points || []) all.push(p.y);
  let y;
  let yTicks;
  if (opts.log) {
    const floor = opts.logFloor ?? 1e-4;
    const lo = Math.max(floor, Math.min(...all.filter((v) => v > 0), 0.1));
    const minExp = Math.floor(Math.log10(lo));
    const maxExp = Math.log10(Math.max(1.5, Math.max(...all) * 1.1));
    y = (v) => m.top + ih - ((Math.log10(Math.max(v, Math.pow(10, minExp))) - minExp) / (maxExp - minExp)) * ih;
    yTicks = [];
    for (let e = minExp; e <= 0; e++) yTicks.push(Math.pow(10, e));
  } else {
    const maxV = Math.max(...all, ...(opts.thresholds || []).map((t) => t.value), opts.yMaxMin || 0) * 1.08;
    const { ticks } = niceTicks(0, maxV, 4);
    const top = ticks[ticks.length - 1] < maxV ? ticks[ticks.length - 1] + (ticks[1] - ticks[0]) : ticks[ticks.length - 1];
    if (top > ticks[ticks.length - 1]) ticks.push(top);
    y = (v) => m.top + ih - (v / top) * ih;
    yTicks = ticks;
  }

  // Title
  svgText(svg, m.left, 14, opts.title, { class: 'ctitle' });
  if (opts.unit) {
    const tw = opts.title.length * 7.2;
    svgText(svg, m.left + tw + 8, 14, opts.unit, { class: 'cunit' });
  }

  const g = svgEl('g', {}, svg);
  // Threshold bands
  for (const th of opts.thresholds || []) {
    const yy = y(th.value);
    if (th.band) svgEl('rect', { x: m.left, y: yy, width: iw, height: Math.max(0, m.top + ih - yy), fill: `var(--band-${th.band})` }, g);
  }
  // Grid
  xAxis(g, x, days, m.top, m.top + ih, iw);
  for (const v of yTicks) {
    const py = y(v);
    svgEl('line', { x1: m.left, x2: m.left + iw, y1: py, y2: py, stroke: 'var(--grid)', 'stroke-width': 1 }, g);
    svgText(g, m.left - 6, py + 3.5, opts.log ? fmtPct(v) : fmtNum(v, Number.isInteger(v) ? 0 : 1), { class: 'tick', 'text-anchor': 'end' });
  }
  svgEl('line', { x1: m.left, x2: m.left + iw, y1: m.top + ih, y2: m.top + ih, stroke: 'var(--axis)', 'stroke-width': 1 }, g);
  for (const th of opts.thresholds || []) {
    const yy = y(th.value);
    svgEl('line', { x1: m.left, x2: m.left + iw, y1: yy, y2: yy, stroke: 'var(--axis)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, g);
    svgText(g, m.left + iw + 4, yy + 3.5, th.label, { class: 'tlabel' });
  }
  if (opts.xLabel) svgText(svg, m.left + iw, height - 2, opts.xLabel, { class: 'tick', 'text-anchor': 'end' });

  // Series (comparison first so the live run sits on top)
  const ordered = [...opts.series].sort((a, b) => (b.dash ? 1 : 0) - (a.dash ? 1 : 0));
  for (const s of ordered) {
    const tt = s.t || opts.t;
    const step = Math.max(1, Math.floor(tt.length / (iw * 1.5)));
    let d = '';
    for (let i = 0; i < tt.length; i += step) {
      if (tt[i] > days) break;
      d += (d ? 'L' : 'M') + x(tt[i]).toFixed(1) + ',' + y(s.values[i]).toFixed(1);
    }
    svgEl('path', {
      d, fill: 'none', stroke: s.color, 'stroke-width': s.dash ? 1.5 : 2,
      'stroke-dasharray': s.dash ? '5 4' : null, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }, g);
  }
  // Observations
  for (const p of opts.points || []) {
    if (p.x > days) continue;
    svgEl('circle', { cx: x(p.x), cy: y(p.y), r: 4.5, fill: 'var(--surface)', stroke: p.color || 'var(--ink-2)', 'stroke-width': 2 }, g);
  }
  // End labels (live series only, when few)
  const live = opts.series.filter((s) => !s.dash);
  if (opts.endLabels !== false && live.length <= 1) {
    for (const s of live) {
      const v = s.values[s.values.length - 1];
      const tt = s.t || opts.t;
      const px = x(Math.min(days, tt[tt.length - 1]));
      svgEl('circle', { cx: px, cy: y(v), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, g);
    }
  }
  // Nadir marker
  if (opts.nadir && Number.isFinite(opts.nadir.value)) {
    const nx = x(opts.nadir.day);
    const ny = y(opts.nadir.value);
    svgEl('circle', { cx: nx, cy: ny, r: 4, fill: opts.series[0].color, stroke: 'var(--surface)', 'stroke-width': 2 }, g);
    const label = 'nadir ' + format(opts.nadir.value);
    const anchor = nx > m.left + iw - 80 ? 'end' : 'start';
    const ly = ny - 8 < m.top + 8 ? ny + 16 : ny - 8;
    svgText(g, nx + (anchor === 'start' ? 6 : -6), ly, label, { class: 'endlabel', 'text-anchor': anchor });
  }

  // Crosshair + hover
  const todayLine = svgEl('line', { y1: m.top, y2: m.top + ih, stroke: 'var(--accent)', 'stroke-width': 1.5, visibility: 'hidden' }, svg);
  const cross = svgEl('line', { y1: m.top, y2: m.top + ih, stroke: 'var(--ink-2)', 'stroke-width': 1, visibility: 'hidden' }, svg);
  const dots = live.map((s) => svgEl('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
  const hit = svgEl('rect', { x: m.left, y: m.top, width: iw, height: ih, fill: 'transparent', tabindex: 0 }, svg);
  hit.setAttribute('aria-label', `${opts.title}: use arrow keys to step through days`);

  const api = {
    today(day) {
      if (day == null || day < 0 || day > days) return todayLine.setAttribute('visibility', 'hidden');
      todayLine.setAttribute('x1', x(day));
      todayLine.setAttribute('x2', x(day));
      todayLine.setAttribute('visibility', 'visible');
    },
    crosshair(day) {
      if (day == null || day > days) {
        cross.setAttribute('visibility', 'hidden');
        dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
        return;
      }
      const px = x(day);
      cross.setAttribute('x1', px);
      cross.setAttribute('x2', px);
      cross.setAttribute('visibility', 'visible');
      live.forEach((s, k) => {
        const i = nearestIndex(s.t || opts.t, day);
        dots[k].setAttribute('cx', px);
        dots[k].setAttribute('cy', y(s.values[i]));
        dots[k].setAttribute('visibility', 'visible');
      });
    },
    readout(day) {
      return opts.series.map((s) => {
        const i = nearestIndex(s.t || opts.t, day);
        return { label: s.label, color: s.color, dash: s.dash, value: format(s.values[i]) };
      });
    },
  };
  if (opts.hub) {
    opts.hub.register(api);
    const dayFromEvent = (ev) => {
      const r = svg.getBoundingClientRect();
      const sx = ((ev.clientX - r.left) / r.width) * width;
      const d = ((sx - m.left) / iw) * days;
      const tt = opts.t;
      return tt[nearestIndex(tt, Math.max(0, Math.min(days, d)))];
    };
    hit.addEventListener('pointermove', (ev) => opts.hub.show(dayFromEvent(ev), api, ev.clientX, ev.clientY));
    hit.addEventListener('pointerleave', () => opts.hub.hide());
    let kday = 0;
    hit.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      ev.preventDefault();
      const stepDays = Math.max(1, Math.round(days / 60));
      kday = Math.max(0, Math.min(days, kday + (ev.key === 'ArrowRight' ? stepDays : -stepDays)));
      const r = svg.getBoundingClientRect();
      opts.hub.show(kday, api, r.left + (x(kday) / width) * r.width, r.top + r.height * 0.3);
    });
    hit.addEventListener('blur', () => opts.hub.hide());
  }
  return api;
}

/**
 * Exposure + intervention timeline aligned with the line charts' x axis.
 * opts: { days, pulses:[{start,end,dose}], chronic:[{startDay,endDay,ratemGyPerDay}], interventions, hub }
 */
export function timelineChart(el, opts) {
  el.replaceChildren();
  const width = Math.max(280, el.clientWidth || 600);
  const lanes = [];
  lanes.push('dose');
  const ivs = opts.interventions || [];
  if (ivs.length) lanes.push('iv');
  const laneH = { dose: 64, iv: 30 };
  const m = { top: 8, bottom: 22, ...CHART_MARGIN };
  const height = m.top + lanes.reduce((s, l) => s + laneH[l], 0) + m.bottom;
  const iw = width - m.left - m.right;
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' }, el);
  svg.setAttribute('aria-label', 'Timeline of radiation exposures and countermeasures');
  const days = opts.days;
  const x = (d) => m.left + (Math.min(d, days) / days) * iw;
  const g = svgEl('g', {}, svg);
  xAxis(g, x, days, m.top, height - m.bottom, iw);

  let y0 = m.top;
  // Dose lane
  const doseTop = y0 + 16;
  const doseBase = y0 + laneH.dose - 4;
  svgText(g, m.left - 6, doseBase, 'Dose', { class: 'tick', 'text-anchor': 'end' });
  svgEl('line', { x1: m.left, x2: m.left + iw, y1: doseBase, y2: doseBase, stroke: 'var(--axis)', 'stroke-width': 1 }, g);
  const acute = opts.pulses.filter((p) => !p.chronic);
  const maxDose = Math.max(0.01, ...acute.map((p) => p.dose));
  for (const c of opts.chronic || []) {
    const x1 = x(c.startDay);
    const x2 = x(Math.min(days, c.endDay));
    svgEl('rect', { x: x1, y: doseBase - 10, width: Math.max(2, x2 - x1), height: 10, fill: 'var(--accent-wash)', stroke: 'var(--accent)', 'stroke-width': 1, rx: 2 }, g);
    svgText(g, x1 + 4, doseBase - 14, `${c.ratemGyPerDay} mGy/day`, { class: 'tlabel' });
  }
  // cluster nearby pulses for labelling
  const clusters = [];
  for (const p of acute) {
    if (p.start > days) continue;
    const px = x(p.start);
    const last = clusters[clusters.length - 1];
    if (last && px - last.x1 < 22) {
      last.items.push(p);
      last.x1 = px;
    } else clusters.push({ x0: px, x1: px, items: [p] });
  }
  for (const p of acute) {
    if (p.start > days) continue;
    const h = 8 + ((doseBase - doseTop - 8) * p.dose) / maxDose;
    const x1 = x(p.start);
    const w = Math.max(2, x(p.end) - x1);
    svgEl('rect', { x: x1 - (w <= 2 ? 1 : 0), y: doseBase - h, width: w, height: h, fill: 'var(--accent)', rx: 1 }, g);
  }
  for (const c of clusters) {
    const doses = c.items.map((p) => p.dose);
    const same = doses.every((d) => Math.abs(d - doses[0]) < 1e-9);
    const label = c.items.length === 1 ? `${fmtNum(doses[0], doses[0] < 1 ? 2 : 1)} Gy` : same ? `${c.items.length} × ${fmtNum(doses[0], 1)} Gy` : `${fmtNum(doses.reduce((a, b) => a + b, 0), 1)} Gy`;
    const durH = c.items.length === 1 ? (c.items[0].end - c.items[0].start) * 24 : 0;
    const full = durH >= 1 ? `${label} over ${fmtNum(durH, 0)} h` : label;
    const cx = (c.x0 + c.x1) / 2;
    const anchor = cx > m.left + iw - 60 ? 'end' : cx < m.left + 30 ? 'start' : 'middle';
    svgText(g, cx + (anchor === 'start' ? 3 : 0), doseTop - 4, full, { class: 'endlabel', 'text-anchor': anchor });
  }
  if (!acute.length && !(opts.chronic || []).length) {
    svgText(g, m.left + 8, doseBase - 8, 'No exposure', { class: 'tlabel' });
  }
  y0 += laneH.dose;

  if (lanes.includes('iv')) {
    const yy = y0 + 8;
    svgText(g, m.left - 6, yy + 10, 'Rx', { class: 'tick', 'text-anchor': 'end' });
    // Stack overlapping windows in two rows.
    let row = 0;
    for (const iv of ivs) {
      if (iv.kind === 'hsct') {
        const px = x(iv.day);
        svgEl('path', { d: `M${px},${yy} l6,7 l-6,7 l-6,-7 z`, fill: 'var(--iv-hsct)' }, g);
        svgText(g, px + 9, yy + 11, 'Stem cells', { class: 'tlabel' });
        continue;
      }
      const x1 = x(iv.startDay);
      const x2 = x(Math.min(days, iv.endDay));
      const ry = yy + row * 8;
      svgEl('rect', { x: x1, y: ry, width: Math.max(3, x2 - x1), height: 6, rx: 3, fill: iv.kind === 'gcsf' ? 'var(--iv-gcsf)' : 'var(--iv-tpo)' }, g);
      svgText(g, x1, ry + 17 + (row ? 0 : 0), iv.kind === 'gcsf' ? 'G-CSF' : 'TPO-RA', { class: 'tlabel' });
      row = 1 - row;
    }
  }

  const cross = svgEl('line', { y1: m.top, y2: height - m.bottom, stroke: 'var(--ink-2)', 'stroke-width': 1, visibility: 'hidden' }, svg);
  const todayLine = svgEl('line', { y1: m.top, y2: height - m.bottom, stroke: 'var(--accent)', 'stroke-width': 1.5, visibility: 'hidden' }, svg);
  const api = {
    today(day) {
      if (day == null || day < 0 || day > days) return todayLine.setAttribute('visibility', 'hidden');
      todayLine.setAttribute('x1', x(day));
      todayLine.setAttribute('x2', x(day));
      todayLine.setAttribute('visibility', 'visible');
    },
    crosshair(day) {
      if (day == null || day > days) return cross.setAttribute('visibility', 'hidden');
      cross.setAttribute('x1', x(day));
      cross.setAttribute('x2', x(day));
      cross.setAttribute('visibility', 'visible');
    },
    readout() { return []; },
  };
  opts.hub?.register(api);
  return api;
}
