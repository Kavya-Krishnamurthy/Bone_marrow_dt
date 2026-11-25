// Plain-language interpretation of model output for a given day.
import { LINEAGES, ctcaeGrade, interp, expandExposures } from './model.js';

export const LAY_LINEAGE = {
  neutrophil: { title: 'Infection fighters', sub: 'White blood cells (neutrophils)', risk: 'infections' },
  platelet: { title: 'Blood clotting', sub: 'Platelets', risk: 'bruising and bleeding' },
  rbc: { title: 'Oxygen delivery', sub: 'Red cells (hemoglobin)', risk: 'tiredness and breathlessness' },
  lymphocyte: { title: 'Immune defense', sub: 'Lymphocytes', risk: 'weakened immunity' },
};
export const STATUS_WORDS = ['Normal', 'Slightly low', 'Low', 'Very low', 'Dangerously low'];

/** Population levels relative to normal at a given day (day < 0 is before anything happens). */
export function levelsAt(res, day) {
  if (day < 0) {
    const ones = { hsc: 1 };
    for (const l of LINEAGES) { ones[l] = 1; ones['prog_' + l] = 1; }
    return ones;
  }
  const out = { hsc: interp(res.t, res.marrow.hsc, day) };
  for (const l of LINEAGES) {
    out[l] = interp(res.t, res.bloodRel[l], day);
    out['prog_' + l] = interp(res.t, res.marrow[l], day);
  }
  return out;
}

export function healthAt(res, day) {
  const h = {};
  for (const l of LINEAGES) {
    const base = res.profile.baseline[l];
    const rel = day < 0 ? 1 : interp(res.t, res.bloodRel[l], day);
    const value = rel * base;
    h[l] = { rel, value, grade: ctcaeGrade(l, value) };
  }
  return h;
}

export function describeDose(gy) {
  if (gy <= 0) return 'No radiation.';
  if (gy < 0.05) return 'Very low, similar to a few CT scans. No visible effect on blood.';
  if (gy < 0.5) return 'Low. No symptoms expected; blood counts barely change.';
  if (gy < 1) return 'Mild. A small, temporary dip in some blood counts.';
  if (gy < 2) return 'Radiation sickness begins. Blood counts drop for several weeks.';
  if (gy < 3.5) return 'Moderate. Real risk of infection and bleeding; medical care needed.';
  if (gy < 6) return 'Severe. Around the dose that kills half of people who get no treatment.';
  return 'Very severe. Most stem cells are destroyed; survival needs a stem-cell transplant.';
}

export function describeField(fx) {
  if (fx >= 0.99) return 'Whole body exposed. No marrow is protected.';
  if (fx >= 0.7) return `Most of the body. ${Math.round((1 - fx) * 100)}% of the marrow is shielded and keeps working.`;
  if (fx >= 0.4) return `About half the body. ${Math.round((1 - fx) * 100)}% of the marrow is shielded and helps refill the rest.`;
  return `A small part of the body. Most marrow (${Math.round((1 - fx) * 100)}%) is protected.`;
}

/** Key moments for the timeline chips. */
export function keyMoments(res, sum, cfg) {
  const moments = [];
  const pulses = expandExposures(cfg.exposures);
  const acute = pulses.filter((p) => p.end - p.start < 30);
  if (acute.length) moments.push({ day: acute[0].start, kind: 'zap', text: 'Radiation' });
  const chronic = (cfg.exposures || []).find((e) => e.kind === 'chronic');
  if (chronic) moments.push({ day: chronic.startDay, kind: 'zap', text: 'Low dose begins' });
  const add = (l, text) => {
    const s = sum[l];
    if (s.nadirRel < 0.85) moments.push({ day: s.nadirDay, kind: 'low', text });
  };
  add('lymphocyte', 'Immune cells lowest');
  add('neutrophil', 'White cells lowest');
  add('platelet', 'Platelets lowest');
  const n = sum.neutrophil;
  if (n.recoveryDay != null && n.nadirRel < 0.8) moments.push({ day: n.recoveryDay, kind: 'up', text: 'White cells recovered' });
  for (const iv of cfg.interventions || []) {
    if (iv.kind === 'hsct') moments.push({ day: iv.day, kind: 'rx', text: 'Stem-cell transplant' });
    if (iv.kind === 'gcsf') moments.push({ day: iv.startDay, kind: 'rx', text: 'White-cell booster starts' });
    if (iv.kind === 'tpo') moments.push({ day: iv.startDay, kind: 'rx', text: 'Platelet booster starts' });
  }
  return moments.filter((m) => m.day <= cfg.days).sort((a, b) => a.day - b.day);
}

/** Headline and short explanation of what is happening on this day. */
export function narrate(res, sum, cfg, day) {
  const pulses = expandExposures(cfg.exposures);
  const total = sum.totalDose;
  const chronic = (cfg.exposures || []).find((e) => e.kind === 'chronic');
  const first = pulses.length ? pulses[0].start : Infinity;
  const ivs = cfg.interventions || [];

  if (!pulses.length) {
    return { title: 'Healthy marrow', body: 'No radiation is set. The marrow keeps making blood cells at a steady rate. Pick a scenario below to see what changes.' };
  }
  if (day < first) {
    return {
      title: 'Healthy marrow',
      body: 'Stem cells next to the bone keep making new blood cells, which mature and slip into the blood vessel. Press play to see what happens next.',
    };
  }
  const during = pulses.find((p) => day >= p.start && day <= p.end + 0.15 && p.end - p.start < 30);
  if (during) {
    return {
      title: 'Radiation is passing through',
      body: 'Radiation damages the DNA of cells that are dividing. Stem cells, young blood cells and lymphocytes are the most vulnerable. Finished red cells and platelets are barely affected.',
    };
  }

  const h = healthAt(res, day);
  const lv = levelsAt(res, day);
  const worst = Math.max(...LINEAGES.map((l) => h[l].grade));
  const prev = healthAt(res, Math.max(0, day - 1));
  const ancFalling = h.neutrophil.rel < prev.neutrophil.rel - 0.002;
  const ancRising = h.neutrophil.rel > prev.neutrophil.rel + 0.002;
  const sentences = [];

  if (chronic && total < 1.5) {
    const title = worst === 0 ? 'Keeping up with the damage' : 'Counts are dipping';
    sentences.push('Cosmic rays arrive a few at a time. Between hits the marrow repairs DNA and replaces lost cells, so the same total dose does far less harm than if it came all at once.');
    sentences.push(`Total so far: ${(interp(res.t, res.cumDose, day) * 1000).toFixed(0)} mGy.`);
    return { title, body: sentences.join(' ') };
  }

  let title;
  if (worst === 0) title = day > first + 1 && sum.worstGrade > 0 ? 'The marrow has recovered' : 'Blood counts look normal';
  else if (worst <= 2) title = ancRising ? 'Counts are coming back' : 'Blood counts are dipping';
  else if (worst === 3) title = ancRising ? 'Still very low, but recovering' : 'Blood counts are very low';
  else title = 'Danger zone';

  const since = day - first;
  if (since < 7 && h.lymphocyte.grade >= 2) {
    sentences.push('Lymphocytes fall first, within a day or two. Doctors use the speed of this drop to estimate the dose.');
  }
  if (ancFalling && since < 25 && h.neutrophil.rel > 0.15) {
    sentences.push('White cells keep falling: the ones in the blood were made before the exposure and are used up, while few new ones are coming out of the marrow.');
  }
  if (h.neutrophil.grade >= 4) sentences.push('With so few infection fighters, even a minor infection could be life-threatening.');
  else if (h.neutrophil.grade === 3) sentences.push('Infection risk is high.');
  if (h.platelet.grade >= 3) sentences.push('Platelets are low, so bruising and bleeding become a risk.');
  if (lv.hsc < 0.05 && !ivs.some((i) => i.kind === 'hsct' && i.day <= day)) {
    sentences.push('Very few stem cells survived. Recovery will be slow, and at high doses it may not happen without a transplant.');
  } else if (ancRising && worst > 0) {
    sentences.push('Surviving stem cells are refilling the marrow, and new cells are reaching the blood again.');
  }
  if (ivs.some((i) => i.kind === 'gcsf' && day >= i.startDay && day < i.endDay) && h.neutrophil.grade > 0) {
    sentences.push('The white-cell booster (G-CSF) is pushing the marrow to make neutrophils faster.');
  }
  if (ivs.some((i) => i.kind === 'hsct' && day >= i.day && day < i.day + 3)) {
    sentences.push('Donor stem cells have been infused. They settle in the marrow and start rebuilding it.');
  }
  if (h.rbc.grade >= 1 && sentences.length < 3) {
    sentences.push('Red cells live about four months, so hemoglobin drifts down slowly rather than crashing.');
  }
  if (worst === 0 && since > 3) {
    sentences.push(lv.hsc < 0.9 ? `Blood counts are back to normal, though the stem-cell pool is still rebuilding (${Math.round(lv.hsc * 100)}% of normal).` : 'Stem cells, young cells and blood counts are all back near normal.');
  }
  if (!sentences.length) sentences.push('The marrow is working to replace the cells that were lost.');
  return { title, body: sentences.slice(0, 3).join(' ') };
}
