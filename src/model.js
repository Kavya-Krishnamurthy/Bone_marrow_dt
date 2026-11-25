// Bone marrow radiation response model.
//
// A compartmental model of human hematopoiesis under ionizing radiation:
//   HSC  ->  lineage progenitors (P)  ->  3 maturation transit stages (T1..T3)  ->  blood (C)
// for four lineages: neutrophil, platelet, erythrocyte (as hemoglobin) and lymphocyte.
//
// Structure follows the semi-mechanistic myelosuppression model of Friberg et al.
// (J Clin Oncol 2002; 20:4713) with feedback (C0/C)^gamma, extended with an upstream
// stem-cell compartment, a two-site marrow (exposed / shielded) for partial-body
// exposure, and radiation cell kill from the linear-quadratic (LQ) model with
// first-order repair of sublethal damage, which reproduces fractionation and
// dose-rate sparing (Lea-Catcheside dose-protraction factor).
//
// All marrow compartments are normalised to 1 at steady state. Blood compartments
// are normalised to 1 and scaled to the individual's baseline counts for display.
// Time unit: days. Dose unit: Gy (absorbed dose to marrow).
//
// Parameter values are literature-informed defaults, not fitted to individual data.
// See docs/MODEL.md for sources, assumptions and limitations.

export const LINEAGES = ['neutrophil', 'platelet', 'rbc', 'lymphocyte'];

export const LINEAGE_INFO = {
  neutrophil: { label: 'Neutrophils (ANC)', short: 'ANC', unit: '×10⁹/L', progenitor: 'Myeloid progenitors' },
  platelet: { label: 'Platelets', short: 'PLT', unit: '×10⁹/L', progenitor: 'Megakaryocyte progenitors' },
  rbc: { label: 'Hemoglobin', short: 'Hgb', unit: 'g/dL', progenitor: 'Erythroid progenitors' },
  lymphocyte: { label: 'Lymphocytes (ALC)', short: 'ALC', unit: '×10⁹/L', progenitor: 'Lymphoid progenitors' },
};

export const DEFAULT_PARAMS = {
  // Stem cells: logistic regeneration, asymmetric division assumed so differentiation
  // output does not deplete the pool.
  hsc: { alpha: 0.7, beta: 0.06, regen: 0.08 },
  // Progenitors that lose clonogenic capacity keep dividing for a few generations
  // (abortive proliferation) before dying, which delays the blood-count nadir.
  doomedHalfLife: 2,
  // First-order repair of sublethal damage. Half-time ~1.5 h, typical for normal tissue.
  repairHalfTimeHours: 1.5,
  lineages: {
    neutrophil: {
      mtt: 5.5, // marrow transit time progenitor->blood, days (Friberg MTT ~125 h)
      bloodHalfLife: 0.3, // days (~7 h circulating half-life)
      gamma: 0.2, // feedback exponent (G-CSF axis)
      fmax: 3, // cap on feedback amplification
      progenitor: { alpha: 0.75, beta: 0.04 },
      precursor: { alpha: 0.35, beta: 0.02 }, // dividing precursors (T1)
    },
    platelet: {
      mtt: 7,
      bloodHalfLife: 5.5, // ~8-day mean lifespan approximated as exponential
      gamma: 0.35, // TPO axis
      fmax: 3,
      progenitor: { alpha: 0.6, beta: 0.04 },
      precursor: { alpha: 0.25, beta: 0.02 },
    },
    rbc: {
      mtt: 6,
      bloodHalfLife: 83, // ~120-day mean lifespan
      gamma: 0.6, // EPO axis
      fmax: 5,
      progenitor: { alpha: 0.8, beta: 0.04 },
      precursor: { alpha: 0.35, beta: 0.02 },
    },
    lymphocyte: {
      mtt: 10,
      bloodHalfLife: 40,
      gamma: 0.15,
      fmax: 3,
      progenitor: { alpha: 0.9, beta: 0.05 },
      precursor: { alpha: 0.5, beta: 0.03 },
      // Circulating lymphocytes are the one radiosensitive blood population
      // (interphase apoptosis, which follows within ~a day of exposure).
      blood: { alpha: 0.35, beta: 0.03, apoptosisHalfLife: 0.5 },
    },
  },
  interventions: {
    gcsf: { amplification: 1.8, mttFactor: 0.7 },
    tpo: { amplification: 1.6, hscBoost: 0.3 },
  },
};

// Individual profile: the part of the model that a digital twin personalises.
export const DEFAULT_PROFILE = {
  name: 'Reference adult',
  baseline: { neutrophil: 4.0, platelet: 250, rbc: 14.0, lymphocyte: 2.0 },
  radiosensitivity: 1.0, // multiplies every alpha and beta
  marrowReserve: 1.0, // multiplies HSC regeneration rate
};

// CTCAE v5.0 lower bounds for grades 1..4 (value below bound => at least that grade).
// Grade-1 bounds are set to typical adult lower limits of normal.
export const CTCAE = {
  neutrophil: [2.0, 1.5, 1.0, 0.5],
  platelet: [150, 75, 50, 25],
  rbc: [12.0, 10.0, 8.0, null], // Hgb grade 4 is life-threatening consequences, not a count
  lymphocyte: [1.0, 0.8, 0.5, 0.2],
};

export function ctcaeGrade(lineage, value) {
  const bounds = CTCAE[lineage];
  let grade = 0;
  for (let g = 0; g < bounds.length; g++) {
    if (bounds[g] != null && value < bounds[g]) grade = g + 1;
  }
  return grade;
}

/*
 * Exposure schedule.
 *   { kind: 'acute',   day, dose, durationHours = 0, fractions = 1, intervalHours = 24 }
 *   { kind: 'chronic', startDay, endDay, ratemGyPerDay }
 * `exposedFraction` is the share of active marrow in the field (1 = whole body).
 * `shieldedDoseFactor` is the dose to the remaining marrow relative to the field dose.
 */
export function expandExposures(exposures) {
  const pulses = []; // { start, end, dose } in days / Gy
  for (const e of exposures || []) {
    if (e.kind === 'chronic') {
      const rate = (e.ratemGyPerDay || 0) / 1000;
      if (rate > 0 && e.endDay > e.startDay) {
        pulses.push({ start: e.startDay, end: e.endDay, dose: rate * (e.endDay - e.startDay) });
      }
      continue;
    }
    const n = Math.max(1, Math.round(e.fractions || 1));
    const dur = Math.max(0, e.durationHours || 0) / 24;
    const gap = (e.intervalHours ?? 24) / 24;
    for (let i = 0; i < n; i++) {
      const start = (e.day || 0) + i * gap;
      if ((e.dose || 0) > 0) pulses.push({ start, end: start + dur, dose: e.dose });
    }
  }
  return pulses.sort((a, b) => a.start - b.start);
}

export function totalDose(exposures) {
  return expandExposures(exposures).reduce((s, p) => s + p.dose, 0);
}

// Interventions: { kind: 'gcsf' | 'tpo', startDay, endDay } | { kind: 'hsct', day, cellDose }
function activeFactors(interventions, t, params) {
  let gcsf = false;
  let tpo = false;
  for (const iv of interventions || []) {
    if (iv.kind === 'gcsf' && t >= iv.startDay && t < iv.endDay) gcsf = true;
    if (iv.kind === 'tpo' && t >= iv.startDay && t < iv.endDay) tpo = true;
  }
  return {
    gcsf,
    tpo,
    amp: {
      neutrophil: gcsf ? params.interventions.gcsf.amplification : 1,
      platelet: tpo ? params.interventions.tpo.amplification : 1,
      rbc: 1,
      lymphocyte: 1,
    },
    mtt: { neutrophil: gcsf ? params.interventions.gcsf.mttFactor : 1, platelet: 1, rbc: 1, lymphocyte: 1 },
    hscBoost: tpo ? params.interventions.tpo.hscBoost : 0,
  };
}

// State layout (Float64Array):
//   per marrow site s in {0: exposed, 1: shielded}: [S, then per lineage P, Pd, T1, T2, T3]
//   (Pd = doomed, non-clonogenic progenitors)
//   then per lineage: blood C (normalised)
//   then doomed lymphocytes Ld (normalised), then sublethal damage Z for each site.
const SITE_LEN = 1 + LINEAGES.length * 5;
const IDX = {
  site: (s) => s * SITE_LEN,
  S: (s) => s * SITE_LEN,
  P: (s, l) => s * SITE_LEN + 1 + l * 5,
  Pd: (s, l) => s * SITE_LEN + 1 + l * 5 + 1,
  T: (s, l, k) => s * SITE_LEN + 1 + l * 5 + 2 + k, // k = 0..2
  C: (l) => 2 * SITE_LEN + l,
  Ld: 2 * SITE_LEN + LINEAGES.length,
  Z: (s) => 2 * SITE_LEN + LINEAGES.length + 1 + s,
};
const STATE_LEN = 2 * SITE_LEN + LINEAGES.length + 3;

function steadyState() {
  const y = new Float64Array(STATE_LEN);
  for (let s = 0; s < 2; s++) {
    y[IDX.S(s)] = 1;
    for (let l = 0; l < LINEAGES.length; l++) {
      y[IDX.P(s, l)] = 1;
      for (let k = 0; k < 3; k++) y[IDX.T(s, l, k)] = 1;
    }
  }
  for (let l = 0; l < LINEAGES.length; l++) y[IDX.C(l)] = 1;
  return y;
}

function derivatives(y, dy, ctx, factors) {
  const { lin, fx, regen } = ctx;
  dy.fill(0);
  // Feedback depends on circulating counts (lymphocyte feedback sees viable + doomed).
  const fb = new Array(LINEAGES.length);
  for (let l = 0; l < LINEAGES.length; l++) {
    const L = lin[l];
    let c = y[IDX.C(l)];
    if (l === 3) c += y[IDX.Ld];
    c = Math.max(c, 1e-9);
    const amp = factors.amp[LINEAGES[l]];
    fb[l] = Math.min(L.fmax * amp, Math.pow(1 / c, L.gamma) * amp);
  }
  for (let s = 0; s < 2; s++) {
    const S = y[IDX.S(s)];
    dy[IDX.S(s)] = regen * (1 + factors.hscBoost) * S * (1 - S);
    for (let l = 0; l < LINEAGES.length; l++) {
      const ktr = L_ktr(lin[l], factors.mtt[LINEAGES[l]]);
      const P = y[IDX.P(s, l)];
      const Pd = y[IDX.Pd(s, l)];
      dy[IDX.P(s, l)] = ktr * (S * fb[l] - P);
      dy[IDX.Pd(s, l)] = -ctx.kdoom * Pd;
      // Doomed cells still feed maturation until they die out.
      let prev = P + Pd;
      for (let k = 0; k < 3; k++) {
        const T = y[IDX.T(s, l, k)];
        dy[IDX.T(s, l, k)] = ktr * (prev - T);
        prev = T;
      }
    }
  }
  for (let l = 0; l < LINEAGES.length; l++) {
    const L = lin[l];
    const influx = fx * y[IDX.T(0, l, 2)] + (1 - fx) * y[IDX.T(1, l, 2)];
    dy[IDX.C(l)] = L.kcirc * (influx - y[IDX.C(l)]);
  }
  dy[IDX.Ld] = -ctx.kapop * y[IDX.Ld];
  // Z (sublethal damage) handled in the radiation step.
}

function L_ktr(L, mttFactor) {
  return 4 / (L.mtt * mttFactor); // 1 proliferating + 3 transit compartments share the MTT
}

// LQ kill for an increment of dose dd delivered on top of existing sublethal damage Z:
//   log survival = -(alpha*dd + beta*(dd^2 + 2*Z*dd))
// Summed over a fast delivery this gives alpha*D + beta*D^2; protracted delivery with
// repair between increments gives alpha*D + G*beta*D^2 with G < 1.
function lqSurvival(r, dd, Z, sens) {
  return Math.exp(-sens * (r.alpha * dd + r.beta * (dd * dd + 2 * Z * dd)));
}

function irradiate(y, ctx, dd, site) {
  if (dd <= 0) return;
  const { lin, sens, params } = ctx;
  const Z = y[IDX.Z(site)];
  y[IDX.S(site)] *= lqSurvival(params.hsc, dd, Z, sens);
  for (let l = 0; l < LINEAGES.length; l++) {
    const P = y[IDX.P(site, l)];
    const sp = lqSurvival(lin[l].progenitor, dd, Z, sens);
    y[IDX.P(site, l)] = P * sp;
    y[IDX.Pd(site, l)] += P * (1 - sp);
    y[IDX.T(site, l, 0)] *= lqSurvival(lin[l].precursor, dd, Z, sens);
  }
  if (site === 0) {
    // Circulating lymphocytes: the fraction in the field at the time of exposure
    // is approximated by the exposed marrow fraction.
    const li = 3;
    const surv = lqSurvival(lin[li].blood, dd, Z, sens);
    const killed = y[IDX.C(li)] * (1 - surv) * ctx.fx;
    y[IDX.C(li)] -= killed;
    y[IDX.Ld] += killed;
  }
  y[IDX.Z(site)] = Z + dd;
}

function buildContext(params, profile, fx) {
  const lin = LINEAGES.map((name) => {
    const L = params.lineages[name];
    return { ...L, kcirc: Math.LN2 / L.bloodHalfLife };
  });
  return {
    params,
    lin,
    fx,
    sens: profile.radiosensitivity ?? 1,
    regen: params.hsc.regen * (profile.marrowReserve ?? 1),
    mu: Math.LN2 / (params.repairHalfTimeHours / 24),
    kapop: Math.LN2 / params.lineages.lymphocyte.blood.apoptosisHalfLife,
    kdoom: Math.LN2 / params.doomedHalfLife,
  };
}

/**
 * Run a simulation.
 * @param {object} cfg
 *   exposures, exposedFraction (0..1), shieldedDoseFactor (0..1), interventions,
 *   days (horizon), profile, params, outputStep (days between stored samples)
 * @returns {{t:number[], blood:Object, marrow:Object, doseRate:number[], cumDose:number[]}}
 */
export function simulate(cfg = {}) {
  const params = cfg.params || DEFAULT_PARAMS;
  const profile = { ...DEFAULT_PROFILE, ...(cfg.profile || {}) };
  profile.baseline = { ...DEFAULT_PROFILE.baseline, ...((cfg.profile || {}).baseline || {}) };
  const fx = clamp(cfg.exposedFraction ?? 1, 0, 1);
  const shield = clamp(cfg.shieldedDoseFactor ?? 0, 0, 1);
  const days = cfg.days ?? 60;
  const outStep = cfg.outputStep ?? 0.25;
  const dtMax = 0.01; // days (14.4 min)
  const ctx = buildContext(params, profile, fx);
  const pulses = expandExposures(cfg.exposures);
  const hsct = (cfg.interventions || []).filter((i) => i.kind === 'hsct').sort((a, b) => a.day - b.day);

  const y = steadyState();
  const k1 = new Float64Array(STATE_LEN);
  const k2 = new Float64Array(STATE_LEN);
  const k3 = new Float64Array(STATE_LEN);
  const k4 = new Float64Array(STATE_LEN);
  const tmp = new Float64Array(STATE_LEN);

  const out = {
    t: [],
    blood: Object.fromEntries(LINEAGES.map((n) => [n, []])),
    bloodRel: Object.fromEntries(LINEAGES.map((n) => [n, []])),
    marrow: { hsc: [], ...Object.fromEntries(LINEAGES.map((n) => [n, []])) },
    doseRate: [], // Gy/day to the field, averaged over the output interval
    cumDose: [],
    profile,
    exposedFraction: fx,
  };

  // Event times: every pulse boundary and HSCT so the integrator lands on them.
  const breaks = new Set([0, days]);
  for (const p of pulses) {
    if (p.start < days) breaks.add(p.start);
    if (p.end < days) breaks.add(p.end);
  }
  for (const h of hsct) if (h.day < days) breaks.add(h.day);
  for (let t = 0; t <= days + 1e-9; t += outStep) breaks.add(round9(t));
  const times = [...breaks].filter((t) => t >= 0 && t <= days).sort((a, b) => a - b);

  let cum = 0;
  let lastCum = 0;
  let nextOut = 0;
  let hIdx = 0;
  const record = (t) => {
    out.t.push(round9(t));
    for (let l = 0; l < LINEAGES.length; l++) {
      const name = LINEAGES[l];
      let c = y[IDX.C(l)];
      if (l === 3) c += y[IDX.Ld];
      out.bloodRel[name].push(c);
      out.blood[name].push(c * profile.baseline[name]);
      out.marrow[name].push(fx * y[IDX.P(0, l)] + (1 - fx) * y[IDX.P(1, l)]);
    }
    out.marrow.hsc.push(fx * y[IDX.S(0)] + (1 - fx) * y[IDX.S(1)]);
    out.doseRate.push(out.t.length > 1 ? (cum - lastCum) / outStep : 0);
    out.cumDose.push(cum);
    lastCum = cum;
  };

  const applyInstant = (t) => {
    // Instantaneous pulses (duration 0) starting at t.
    for (const p of pulses) {
      if (p.end === p.start && Math.abs(p.start - t) < 1e-9) {
        irradiate(y, ctx, p.dose, 0);
        if (shield > 0) irradiate(y, ctx, p.dose * shield, 1);
        cum += p.dose;
      }
    }
    while (hIdx < hsct.length && hsct[hIdx].day <= t + 1e-9) {
      const add = hsct[hIdx].cellDose ?? 0.05;
      y[IDX.S(0)] += add;
      y[IDX.S(1)] += add;
      hIdx++;
    }
  };

  const doseRateAt = (t) => {
    let r = 0;
    for (const p of pulses) if (p.end > p.start && t >= p.start && t < p.end) r += p.dose / (p.end - p.start);
    return r;
  };

  applyInstant(0);
  record(0);
  nextOut = outStep;
  for (let i = 0; i < times.length - 1; i++) {
    const t0 = times[i];
    const t1 = times[i + 1];
    const span = t1 - t0;
    if (span <= 0) continue;
    const n = Math.max(1, Math.ceil(span / dtMax - 1e-9));
    const dt = span / n;
    const rate = doseRateAt(t0 + span / 2);
    for (let j = 0; j < n; j++) {
      const t = t0 + j * dt;
      const factors = activeFactors(cfg.interventions, t + dt / 2, params);
      // Radiation (operator split, exact exponential kill per sub-step).
      if (rate > 0) {
        const dd = rate * dt;
        irradiate(y, ctx, dd, 0);
        if (shield > 0) irradiate(y, ctx, dd * shield, 1);
        cum += dd;
      }
      // Repair of sublethal damage.
      const decay = Math.exp(-ctx.mu * dt);
      y[IDX.Z(0)] *= decay;
      y[IDX.Z(1)] *= decay;
      // Biology: RK4.
      derivatives(y, k1, ctx, factors);
      for (let q = 0; q < STATE_LEN; q++) tmp[q] = y[q] + 0.5 * dt * k1[q];
      derivatives(tmp, k2, ctx, factors);
      for (let q = 0; q < STATE_LEN; q++) tmp[q] = y[q] + 0.5 * dt * k2[q];
      derivatives(tmp, k3, ctx, factors);
      for (let q = 0; q < STATE_LEN; q++) tmp[q] = y[q] + dt * k3[q];
      derivatives(tmp, k4, ctx, factors);
      for (let q = 0; q < STATE_LEN; q++) {
        y[q] = Math.max(0, y[q] + (dt / 6) * (k1[q] + 2 * k2[q] + 2 * k3[q] + k4[q]));
      }
    }
    applyInstant(t1);
    if (t1 >= nextOut - 1e-9) {
      record(t1);
      nextOut += outStep;
    }
  }
  return out;
}

/** Clinically oriented summary of a simulation result. */
export function summarize(res) {
  const summary = {};
  const t = res.t;
  for (const name of LINEAGES) {
    const v = res.blood[name];
    let minV = Infinity;
    let minT = 0;
    for (let i = 0; i < v.length; i++) if (v[i] < minV) { minV = v[i]; minT = t[i]; }
    const base = res.profile.baseline[name];
    // Days at grade >= 3 and >= 4.
    let g3 = 0;
    let g4 = 0;
    for (let i = 1; i < v.length; i++) {
      const g = ctcaeGrade(name, v[i]);
      const dt = t[i] - t[i - 1];
      if (g >= 3) g3 += dt;
      if (g >= 4) g4 += dt;
    }
    // Recovery: first time after the nadir that the count is back to >= 80% of baseline.
    let recovery = null;
    const nadirIdx = t.indexOf(minT);
    if (minV < 0.8 * base) {
      for (let i = nadirIdx; i < v.length; i++) if (v[i] >= 0.8 * base) { recovery = t[i]; break; }
    }
    summary[name] = {
      nadir: minV,
      nadirDay: minT,
      nadirRel: minV / base,
      worstGrade: ctcaeGrade(name, minV),
      daysGrade3: g3,
      daysGrade4: g4,
      recoveryDay: recovery,
      final: v[v.length - 1],
    };
  }
  summary.hscNadir = Math.min(...res.marrow.hsc);
  summary.hscFinal = res.marrow.hsc[res.marrow.hsc.length - 1];
  summary.totalDose = res.cumDose[res.cumDose.length - 1];
  summary.worstGrade = Math.max(...LINEAGES.map((n) => summary[n].worstGrade));
  return summary;
}

/*
 * Calibration against observed data (e.g. AVATAR bone-marrow tissue chip read-outs).
 * observations: [{ day, target, value }] where value is relative to unexposed control (1 = control)
 * and target is one of 'hsc' | 'neutrophil' | 'platelet' | 'rbc' | 'lymphocyte'
 *   | 'progenitor:<lineage>' (marrow progenitor pool for that lineage).
 * Fits the radiosensitivity multiplier (and optionally marrow reserve) by grid search on
 * squared log-ratio error.
 */
export function modelValue(res, target, day) {
  let series;
  if (target === 'hsc') series = res.marrow.hsc;
  else if (target.startsWith('progenitor:')) series = res.marrow[target.split(':')[1]];
  else series = res.bloodRel[target];
  if (!series) return NaN;
  return interp(res.t, series, day);
}

export function fitProfile(cfg, observations, opts = {}) {
  const obs = (observations || []).filter((o) => Number.isFinite(o.day) && Number.isFinite(o.value) && o.value > 0);
  if (!obs.length) throw new Error('No usable observations: each row needs a day, a target and a positive value.');
  const days = Math.max(cfg.days ?? 30, Math.ceil(Math.max(...obs.map((o) => o.day))) + 1);
  const sensGrid = opts.sensGrid || range(0.4, 2.0, 0.05);
  const reserveGrid = opts.fitReserve ? (opts.reserveGrid || range(0.4, 2.0, 0.1)) : [cfg.profile?.marrowReserve ?? 1];
  const loss = (res) => {
    let e = 0;
    for (const o of obs) {
      const m = Math.max(modelValue(res, o.target, o.day), 1e-6);
      e += Math.log(m / o.value) ** 2;
    }
    return e / obs.length;
  };
  let best = { loss: Infinity };
  const curve = [];
  for (const r of reserveGrid) {
    for (const s of sensGrid) {
      const res = simulate({ ...cfg, days, outputStep: 0.25, profile: { ...cfg.profile, radiosensitivity: s, marrowReserve: r } });
      const l = loss(res);
      if (r === reserveGrid[0] || !opts.fitReserve) curve.push({ radiosensitivity: s, loss: l });
      if (l < best.loss) best = { loss: l, radiosensitivity: s, marrowReserve: r };
    }
  }
  best.rmseLog = Math.sqrt(best.loss);
  best.n = obs.length;
  best.curve = curve;
  return best;
}

export function parseObservationsCSV(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const di = header.findIndex((h) => h === 'day' || h === 'time_days' || h === 'days');
  const ti = header.findIndex((h) => h === 'target' || h === 'cell_type' || h === 'population');
  const vi = header.findIndex((h) => h === 'value' || h === 'relative' || h === 'fraction_of_control');
  if (di < 0 || ti < 0 || vi < 0) {
    throw new Error('CSV needs columns named day, target and value (see examples/synthetic_chip_data.csv).');
  }
  const valid = new Set(['hsc', ...LINEAGES, ...LINEAGES.map((l) => 'progenitor:' + l)]);
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((c) => c.trim());
    const target = (cells[ti] || '').toLowerCase();
    if (!valid.has(target)) continue;
    rows.push({ day: parseFloat(cells[di]), target, value: parseFloat(cells[vi]) });
  }
  return rows;
}

// Scenario presets. Doses are absorbed dose to active marrow.
export const SCENARIOS = [
  {
    id: 'acute-2',
    name: 'Acute whole-body 2 Gy',
    group: 'Accident',
    note: 'Moderate hematopoietic injury; recovery expected without intervention.',
    exposures: [{ kind: 'acute', day: 0, dose: 2 }],
    exposedFraction: 1,
    days: 60,
  },
  {
    id: 'acute-4',
    name: 'Acute whole-body 4 Gy',
    group: 'Accident',
    note: 'Near the untreated human LD50/60 range; deep neutropenia and thrombocytopenia.',
    exposures: [{ kind: 'acute', day: 0, dose: 4 }],
    exposedFraction: 1,
    days: 90,
  },
  {
    id: 'acute-4-gcsf',
    name: '4 Gy with G-CSF from day 1',
    group: 'Accident',
    note: 'Same exposure, with filgrastim-like support for 21 days.',
    exposures: [{ kind: 'acute', day: 0, dose: 4 }],
    exposedFraction: 1,
    interventions: [{ kind: 'gcsf', startDay: 1, endDay: 22 }],
    days: 90,
  },
  {
    id: 'partial-6',
    name: 'Partial-body 6 Gy, 60% marrow in field',
    group: 'Accident',
    note: 'Shielded marrow repopulates; compare with whole-body exposure.',
    exposures: [{ kind: 'acute', day: 0, dose: 6 }],
    exposedFraction: 0.6,
    days: 90,
  },
  {
    id: 'tbi-12',
    name: 'TBI 12 Gy in 6 fractions',
    group: 'Clinical',
    note: 'Myeloablative conditioning (2 Gy twice daily for 3 days), stem-cell rescue on day 5.',
    exposures: [{ kind: 'acute', day: 0, dose: 2, fractions: 6, intervalHours: 12, durationHours: 0.25 }],
    exposedFraction: 1,
    interventions: [{ kind: 'hsct', day: 5, cellDose: 0.02 }],
    days: 90,
  },
  {
    id: 'spe',
    name: 'Solar particle event, 1.5 Gy over 12 h',
    group: 'Spaceflight',
    note: 'Large SPE behind light shielding; dose protraction spares marrow relative to an acute 1.5 Gy.',
    exposures: [{ kind: 'acute', day: 2, dose: 1.5, durationHours: 12 }],
    exposedFraction: 1,
    days: 60,
  },
  {
    id: 'gcr-mars',
    name: 'Deep-space GCR, 0.5 mGy/day for 900 days',
    group: 'Spaceflight',
    note: 'Mars-class mission background. Total marrow dose ~0.45 Gy at very low dose rate.',
    exposures: [{ kind: 'chronic', startDay: 0, endDay: 900, ratemGyPerDay: 0.5 }],
    exposedFraction: 1,
    days: 900,
  },
];

export function scenarioConfig(id) {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error('Unknown scenario ' + id);
  return {
    exposures: structuredClone(s.exposures),
    exposedFraction: s.exposedFraction ?? 1,
    shieldedDoseFactor: s.shieldedDoseFactor ?? 0,
    interventions: structuredClone(s.interventions || []),
    days: s.days ?? 60,
  };
}

// --- helpers ---
function clamp(x, a, b) {
  return Math.min(b, Math.max(a, x));
}
function round9(x) {
  return Math.round(x * 1e9) / 1e9;
}
function range(a, b, step) {
  const out = [];
  for (let x = a; x <= b + 1e-9; x += step) out.push(Math.round(x * 1000) / 1000);
  return out;
}
export function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}
