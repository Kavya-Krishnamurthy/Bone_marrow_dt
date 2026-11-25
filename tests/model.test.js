import test from 'node:test';
import assert from 'node:assert/strict';
import {
  simulate, summarize, totalDose, expandExposures, ctcaeGrade, fitProfile,
  parseObservationsCSV, modelValue, SCENARIOS, scenarioConfig, DEFAULT_PARAMS,
} from '../src/model.js';

const acute = (dose, extra = {}) => ({ exposures: [{ kind: 'acute', day: 0, dose, ...extra }], days: 60 });

test('no exposure keeps every count at baseline', () => {
  const r = simulate({ exposures: [], days: 30 });
  for (const k of Object.keys(r.bloodRel)) {
    for (const v of r.bloodRel[k]) assert.ok(Math.abs(v - 1) < 1e-9, `${k} drifted to ${v}`);
  }
  assert.ok(r.marrow.hsc.every((v) => Math.abs(v - 1) < 1e-9));
});

test('acute dose applies LQ survival to stem cells immediately', () => {
  const D = 3;
  const r = simulate(acute(D));
  const { alpha, beta } = DEFAULT_PARAMS.hsc;
  assert.ok(Math.abs(r.marrow.hsc[0] - Math.exp(-alpha * D - beta * D * D)) < 1e-9);
});

test('nadir deepens monotonically with dose', () => {
  let prev = Infinity;
  for (const D of [0.5, 1, 2, 3, 4, 6]) {
    const s = summarize(simulate(acute(D)));
    assert.ok(s.neutrophil.nadir < prev, `ANC nadir not deeper at ${D} Gy`);
    prev = s.neutrophil.nadir;
  }
});

test('nadir timing follows lineage kinetics (lymphocytes < neutrophils < platelets)', () => {
  const s = summarize(simulate({ ...acute(4), days: 90 }));
  assert.ok(s.lymphocyte.nadirDay < 7);
  assert.ok(s.neutrophil.nadirDay > 8 && s.neutrophil.nadirDay < 30);
  assert.ok(s.platelet.nadirDay > s.neutrophil.nadirDay);
});

test('fractionation spares stem cells relative to a single acute dose', () => {
  const single = simulate(acute(6));
  const split = simulate({ exposures: [{ kind: 'acute', day: 0, dose: 2, fractions: 3, intervalHours: 24 }], days: 60 });
  // Compare immediately after the last fraction, before regeneration matters much.
  const j = split.t.indexOf(2);
  assert.ok(split.marrow.hsc[j] > single.marrow.hsc[0] * 1.5);
});

test('protracted delivery spares relative to acute (dose-rate effect)', () => {
  const fast = simulate({ exposures: [{ kind: 'acute', day: 0, dose: 4 }], days: 2, outputStep: 0.25 });
  const slow = simulate({ exposures: [{ kind: 'acute', day: 0, dose: 4, durationHours: 24 }], days: 2, outputStep: 0.25 });
  assert.ok(Math.abs(totalDose([{ kind: 'acute', day: 0, dose: 4, durationHours: 24 }]) - 4) < 1e-9);
  const last = (r) => r.cumDose[r.cumDose.length - 1];
  assert.ok(Math.abs(last(slow) - 4) < 1e-6, 'slow delivery should deliver the full dose');
  // Stem cells regenerate a little during 24 h, so check survival advantage is large.
  assert.ok(slow.marrow.hsc.at(-1) > fast.marrow.hsc.at(-1) * 1.3);
});

test('partial-body exposure spares marrow', () => {
  const whole = summarize(simulate({ ...acute(6), days: 90 }));
  const partial = summarize(simulate({ ...acute(6), days: 90, exposedFraction: 0.5 }));
  assert.ok(partial.neutrophil.nadir > whole.neutrophil.nadir * 2);
  assert.ok(partial.hscNadir > 0.45);
});

test('G-CSF raises the neutrophil nadir', () => {
  const base = summarize(simulate({ ...acute(4), days: 60 }));
  const g = summarize(simulate({ ...acute(4), days: 60, interventions: [{ kind: 'gcsf', startDay: 1, endDay: 22 }] }));
  assert.ok(g.neutrophil.nadir > base.neutrophil.nadir);
  assert.ok(g.neutrophil.daysGrade4 <= base.neutrophil.daysGrade4);
});

test('exposure expansion handles fractions and chronic exposure', () => {
  const p = expandExposures([
    { kind: 'acute', day: 1, dose: 2, fractions: 3, intervalHours: 12 },
    { kind: 'chronic', startDay: 0, endDay: 10, ratemGyPerDay: 1 },
  ]);
  assert.equal(p.length, 4);
  assert.ok(Math.abs(p.reduce((s, x) => s + x.dose, 0) - 6.01) < 1e-9);
});

test('CTCAE grading', () => {
  assert.equal(ctcaeGrade('neutrophil', 0.4), 4);
  assert.equal(ctcaeGrade('neutrophil', 0.9), 3);
  assert.equal(ctcaeGrade('platelet', 200), 0);
  assert.equal(ctcaeGrade('rbc', 7.5), 3);
});

test('every preset runs and returns finite values', () => {
  for (const s of SCENARIOS) {
    const r = simulate({ ...scenarioConfig(s.id), days: Math.min(s.days, 120) });
    for (const k of Object.keys(r.blood)) assert.ok(r.blood[k].every(Number.isFinite), `${s.id} ${k}`);
  }
});

test('calibration recovers a known radiosensitivity from synthetic observations', () => {
  const cfg = { ...acute(2), days: 21 };
  const truth = simulate({ ...cfg, profile: { radiosensitivity: 1.3 } });
  const obs = [];
  for (const day of [1, 3, 7, 14]) {
    obs.push({ day, target: 'hsc', value: modelValue(truth, 'hsc', day) });
    obs.push({ day, target: 'progenitor:neutrophil', value: modelValue(truth, 'progenitor:neutrophil', day) });
  }
  const fit = fitProfile(cfg, obs);
  assert.ok(Math.abs(fit.radiosensitivity - 1.3) < 0.051, `got ${fit.radiosensitivity}`);
});

test('CSV parser accepts the documented format', () => {
  const rows = parseObservationsCSV('# comment\nday,target,value\n1,hsc,0.5\n2,progenitor:platelet,0.3\n3,unknown,1\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { day: 2, target: 'progenitor:platelet', value: 0.3 });
});
