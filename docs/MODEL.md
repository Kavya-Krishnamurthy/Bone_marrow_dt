# Model description

This document describes the equations, default parameters, assumptions and limitations of the bone marrow radiation-response model in `src/model.js`. It also sets out how the model is meant to grow into an AVATAR-specific digital twin.

## 1. Structure

The marrow is simulated as **two sites**: the part inside the radiation field (fraction `f` of active marrow) and the shielded remainder (`1 − f`). Each site holds:

| Symbol | Compartment | Normalised steady state |
|---|---|---|
| `S` | Hematopoietic stem cells (HSC) | 1 |
| `P_l` | Clonogenic progenitors of lineage *l* | 1 |
| `Pd_l` | Doomed (non-clonogenic) progenitors | 0 |
| `T1_l … T3_l` | Maturation stages (T1 = dividing precursors) | 1 |

There are four lineages *l*: neutrophil, platelet, erythrocyte (reported as hemoglobin) and lymphocyte. Each feeds one blood compartment `C_l`, shared by both sites. Lymphocytes also have a doomed blood pool `Ld` for cells killed by interphase apoptosis that have not yet cleared.

### Biology (between radiation increments)

```
dS/dt   = r · (1 + b_TPO) · S · (1 − S)                       logistic HSC regeneration
dP/dt   = k_tr · (S · F_l − P)                                 HSC-driven, feedback-amplified progenitor production
dPd/dt  = −k_d · Pd                                            abortive proliferation, then death
dT1/dt  = k_tr · (P + Pd − T1)
dT2/dt  = k_tr · (T1 − T2)
dT3/dt  = k_tr · (T2 − T3)
dC/dt   = k_circ · (f · T3_exposed + (1 − f) · T3_shielded − C)
dLd/dt  = −k_apop · Ld
F_l     = min(Fmax_l · a_l, a_l · (1 / C_l)^γ_l)               feedback from the circulating count
k_tr    = 4 / (MTT_l · m_l)
```

`a_l` and `m_l` are the amplification and transit-time factors from countermeasures (both 1 when there is none). The structure follows the semi-mechanistic myelosuppression model of Friberg et al. (2002): a proliferating pool, three transit compartments and `(C0/C)^γ` feedback. The extensions are an upstream stem-cell compartment, a doomed-cell pool and the two-site marrow.

The HSC pool is assumed to divide asymmetrically, so producing progenitors does not deplete it. As a result, progenitor output is capped at `S · Fmax`. When the stem-cell pool is badly depleted, blood counts cannot recover until `S` regrows. This is what makes high-dose aplasia prolonged, and what makes a stem-cell infusion matter.

### Radiation (linear-quadratic with repair)

Each site carries a sublethal-damage variable `Z` (Gy), which decays with the repair half-time: `dZ/dt = Ḋ − μZ`. Over an integration step, a dose increment `dd` scales each radiosensitive compartment by:

```
survival = exp(−s · (α · dd + β · (dd² + 2 · Z · dd)))
```

Here `s` is the individual radiosensitivity multiplier. For an instantaneous dose `D` this reduces to the standard LQ form `exp(−αD − βD²)`. For protracted or fractionated delivery, repair between increments shrinks the quadratic term (the Lea–Catcheside dose-protraction factor). That is why low dose rates and fractionation spare marrow in the model.

The radiosensitive populations are `S`, `P_l` (killed cells move to `Pd_l`), `T1_l` (dividing precursors) and circulating lymphocytes. Killed lymphocytes move to `Ld`. Mature neutrophils, platelets and red cells are treated as radioresistant.

### Numerics

Biology is integrated with fixed-step RK4 (step ≤ 0.01 day). Radiation is applied by operator splitting, with an exact exponential kill per step. Instantaneous pulses are applied exactly at their start time, and the integrator lands on every pulse boundary.

## 2. Default parameters

These defaults are literature-informed placeholders chosen to reproduce qualitative human ARS patterns. They have **not** been fitted to individual data.

| Parameter | Neutrophil | Platelet | RBC (Hgb) | Lymphocyte |
|---|---|---|---|---|
| Marrow transit time MTT (d) | 5.5 | 7 | 6 | 10 |
| Blood half-life (d) | 0.3 (~7 h) | 5.5 (~8 d mean life) | 83 (~120 d mean life) | 40 |
| Feedback exponent γ | 0.2 | 0.35 | 0.6 | 0.15 |
| Feedback cap Fmax | 3 | 3 | 5 | 3 |
| Progenitor α / β (Gy⁻¹ / Gy⁻²) | 0.75 / 0.04 | 0.6 / 0.04 | 0.8 / 0.04 | 0.9 / 0.05 |
| Precursor (T1) α / β | 0.35 / 0.02 | 0.25 / 0.02 | 0.35 / 0.02 | 0.5 / 0.03 |
| Circulating α / β | – | – | – | 0.35 / 0.03, apoptosis t½ 0.5 d |

| Shared parameter | Value |
|---|---|
| HSC α / β | 0.7 Gy⁻¹ / 0.06 Gy⁻² |
| HSC regeneration rate `r` | 0.08 /day |
| Doomed-progenitor half-life | 2 days |
| Sublethal-damage repair half-time | 1.5 h |
| G-CSF effect | ×1.8 neutrophil amplification, ×0.7 marrow transit time |
| TPO receptor agonist effect | ×1.6 platelet amplification, +30% HSC regeneration |
| Stem-cell infusion | adds the graft (fraction of a normal HSC pool) to both sites |

Reference profile: ANC 4.0, platelets 250, ALC 2.0 (×10⁹/L), Hgb 14 g/dL, with both multipliers at 1.0.

### Behaviour with these defaults

| Scenario | ANC nadir (×10⁹/L, day) | Platelet nadir (×10⁹/L, day) | ALC day 4 |
|---|---|---|---|
| 1.5 Gy acute | 2.13 | 157 | 1.16 |
| 1.5 Gy over 12 h (SPE preset) | 2.25 | 163 | 1.21 |
| 2 Gy acute | 1.62, day 12.5 | 129, day 21 | 0.95 |
| 4 Gy acute | 0.40, day 16.5 | 48, day 28 | 0.40 |
| 4 Gy + G-CSF days 1–22 | 0.61, day 13.5 | 48, day 28 | 0.40 |
| 6 Gy, 60% of marrow in field | 1.88, day 19 | 127, day 32 | 0.92 |
| 0.5 mGy/day × 900 d (GCR preset) | 3.99 (no visible change) | 249 | 1.97 |

(Computed with the defaults above. Rerun the model after changing parameters.)

The order of events matches clinical descriptions of hematopoietic ARS: lymphocytes drop within days, neutrophils reach their nadir in weeks 2–3 and platelets in weeks 3–4, and hemoglobin falls only slowly. Recovery is limited by stem-cell regrowth. The exact depths and durations are uncalibrated.

## 3. Outputs

* Blood counts in clinical units, graded with **CTCAE v5.0** thresholds (grade 1 uses typical adult lower limits of normal: ANC 2.0, PLT 150, Hgb 12, ALC 1.0).
* For each lineage: nadir and its day, days at grade ≥ 3 and ≥ 4, and the day the count returns to 80% of baseline.
* Marrow pools relative to pre-exposure: HSC plus the four progenitor pools, each a marrow-weighted average over the two sites.

## 4. Calibration and the path to an AVATAR digital twin

The model separates **shared biology** (`DEFAULT_PARAMS`) from an **individual profile** (`DEFAULT_PROFILE`). The profile holds baseline counts, a radiosensitivity multiplier and a marrow regenerative-reserve multiplier.

`fitProfile()` grid-searches the profile multipliers to minimise the mean squared log-ratio between model and observations. The observations are measurements relative to unexposed control, which is the natural read-out of a bone-marrow tissue chip built from a person's own cells (for example CD34⁺ viability, or colony-forming units per lineage after a dose).

CSV format, also in `examples/synthetic_chip_data.csv`:

```
day,target,value
1,hsc,0.12
1,progenitor:neutrophil,0.14
7,neutrophil,0.55
```

Valid targets: `hsc`, `progenitor:<lineage>`, or a blood lineage (`neutrophil`, `platelet`, `rbc`, `lymphocyte`). Lines starting with `#` are ignored.

> `examples/synthetic_chip_data.csv` is **synthetic**. The model itself generated it (radiosensitivity 1.25, 2 Gy acute) and added about ±10% deterministic noise. It exists to demonstrate and test the calibration path. It is not experimental data.

Suggested next steps toward an AVATAR-specific twin:

1. **Per-lineage radiosensitivity from chips.** Replace the single multiplier with per-lineage α/β fitted to dose-graded chip survival (colony-forming assays at several doses separate α from β).
2. **Dose-rate experiments.** Chip exposures at different dose rates would constrain the repair half-time.
3. **Radiation quality.** Add an RBE or LET-dependent α for high-LET ions (GCR, SPE secondaries), with a reduced β and less repair at high LET.
4. **Uncertainty.** Replace the grid search with a Bayesian fit (for example MCMC over the profile and key shared parameters) and show prediction bands.
5. **Longitudinal personal data.** Use the person's own historical blood counts to set baselines and feedback strength (γ).
6. **Validation.** Compare against published human ARS case series and nonhuman-primate H-ARS countermeasure studies before using the model for any decision.

## 5. Limitations

* No mortality, infection, bleeding, transfusion or supportive-care model, and no GI or cutaneous syndromes.
* Omits the early neutrophilia from demargination and the "abortive rise" of neutrophils.
* The HSC pool has no niche, no migration between marrow sites, no exhaustion and no clonal dynamics, so long-term late effects are out of scope.
* Lymphocyte homeostasis is simplified (no thymic output, no homeostatic proliferation by subset).
* The share of circulating lymphocytes in the field is approximated by the exposed marrow fraction.
* Dose is absorbed dose to marrow. Dose heterogeneity within the field is not represented.
* Countermeasure effects are phenomenological multipliers, not pharmacokinetic models.
* A stem-cell infusion starts producing progenitors immediately (no homing or engraftment delay), so the myeloablative TBI preset shows a shallower, shorter nadir than clinical conditioning does.

## References (structure and concepts)

* Friberg LE, Henningsson A, Maas H, Nguyen L, Karlsson MO. Model of chemotherapy-induced myelosuppression with parameter consistency across drugs. *J Clin Oncol* 2002;20:4713–4721.
* Fowler JF. The linear-quadratic formula and progress in fractionated radiotherapy. *Br J Radiol* 1989;62:679–694. (LQ model; incomplete-repair / dose-protraction factor.)
* Fliedner TM, Friesecke I, Beyrer K (eds). *Medical Management of Radiation Accidents: Manual on the Acute Radiation Syndrome* (METREPOL). British Institute of Radiology, 2001.
* Smirnova OA. Mathematical models of hematopoiesis dynamics in nonirradiated and irradiated mammals. Reviewed in: *Environmental Radiation Effects on Mammals: A Dynamical Modeling Approach*, Springer, 2010/2017.
* National Cancer Institute. Common Terminology Criteria for Adverse Events (CTCAE) v5.0, 2017.
