# Bone_marrow_dt: Marrow Under Radiation

An interactive, data-informed bone marrow simulation. Use it to explore radiation exposure scenarios and see modelled changes in hematopoietic cell populations over time. It is a preliminary step toward an AVATAR-specific digital twin.

## What it does

The main screen is an **animated, labelled cross-section of bone marrow** that anyone can follow: bone, stem cells, young blood cells, fat cells and a blood vessel carrying finished cells. Press play and the numbers of cells on screen follow the model day by day. Radiation shows up as flashes (or, for space travel, single cosmic-ray tracks). Plain-language health meters, a narrated story for each day, a body map of where marrow is, and key-moment shortcuts sit beside it. Hover over any cell for an explanation. Everything below remains available under **Expert view**.


* **Exposure scenarios**: acute, fractionated, protracted (for example a solar particle event) and chronic low-dose-rate exposure (for example deep-space GCR), with partial-body fields and shielded marrow.
* **Hematopoietic response**: day-by-day stem cells, four progenitor pools and peripheral blood counts (ANC, platelets, hemoglobin, lymphocytes), graded with CTCAE v5 thresholds.
* **Countermeasures**: G-CSF, a TPO receptor agonist and stem-cell infusion, each with its own timing.
* **Individual profile**: baseline counts plus radiosensitivity and regenerative-reserve multipliers, the parameters a digital twin personalises.
* **Calibration**: load tissue-chip read-outs (relative to unexposed control) as CSV and fit the profile to them. A clearly labelled synthetic example is included.
* **Comparison**: pin one run and overlay it on the next, for example with and without G-CSF, or acute versus protracted dose.
* **Accessible output**: synced crosshair tooltips, keyboard stepping through days, a data table and CSV copy.

The model is a Friberg-type myelosuppression structure extended with an upstream stem-cell compartment, doomed-progenitor kinetics, a two-site (exposed/shielded) marrow, and linear-quadratic cell kill with repair of sublethal damage. See **[docs/MODEL.md](docs/MODEL.md)** for the equations, parameters, references, limitations and the calibration roadmap.

> Research and education tool. Outputs are hypotheses, not clinical guidance. Default parameters are literature-informed and have not been fitted to individual data.

## Run it

No dependencies. Any static server works, because ES modules need `http://` rather than `file://`:

```bash
npm run serve        # python3 -m http.server 8000, then open http://localhost:8000
```

Or build the single self-contained file, which also works when opened directly from disk:

```bash
npm run build        # writes dist/marrow-dose-response.html
```

## Test

```bash
npm test             # Node ≥ 18, uses node:test
```

The tests check that the unexposed steady state is stable, that acute survival matches analytic LQ, that nadirs deepen with dose, and that nadir timing runs lymphocytes, then neutrophils, then platelets. They also check fractionation, dose-rate and partial-body sparing, the G-CSF effect, CTCAE grading, and that calibration recovers a known radiosensitivity.

## Layout

| Path | Contents |
|---|---|
| `src/model.js` | Pure simulation, summary, calibration and CSV parsing (runs in the browser and in Node) |
| `src/scene.js` | Canvas illustration of the marrow: animated cells, radiation effects and labels |
| `src/story.js` | Plain-language narration, health meters and key moments |
| `src/charts.js` | Dependency-free SVG charts with a synced crosshair (expert view) |
| `src/app.js` | UI controller |
| `index.html`, `styles.css` | Page and theme (light and dark) |
| `scripts/build.mjs` | Single-file bundler |
| `examples/synthetic_chip_data.csv` | Synthetic calibration example (model-generated, not measurements) |
| `docs/MODEL.md` | Model documentation |
| `tests/` | Unit tests |

## Using the model from code

```js
import { simulate, summarize } from './src/model.js';

const res = simulate({
  exposures: [{ kind: 'acute', day: 0, dose: 4 }],
  exposedFraction: 1,
  interventions: [{ kind: 'gcsf', startDay: 1, endDay: 22 }],
  days: 90,
  profile: { radiosensitivity: 1.2 },
});
console.log(summarize(res).neutrophil); // nadir, nadirDay, daysGrade4, recoveryDay, ...
```
