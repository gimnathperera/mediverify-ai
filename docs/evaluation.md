# RAG evaluation

Reproduce with `pnpm eval` (fixture LLM) or `pnpm eval:live` (OpenAI; needs `OPENAI_API_KEY`). Each run writes
JSON with `--out <file>`. CI runs the fixture evaluation on every pull request and push to `main`, and keeps `eval-report.json` as an artifact.
**The numbers below were measured, not estimated.** Each section says which LLM mode produced it.

## Evaluation set

| Item                     | Contents                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Golden document          | `resources/primary_document_medical.pdf`: 6 prescriptions (`fixtures/golden.json`)                                                     |
| Reference                | `resources/reference_document_medical.pdf` rev 8.2: 8 monographs, 100 chunks (8 parent, 72 field, 20 non-monograph)                    |
| Positive identities      | Velantine, Cordizem-XR, Pravoxil, Etrazolam, Quintaxin                                                                                 |
| Negative identities      | Pranixol (from the document), plus adversarial look-alikes: Velantina, Quintaxol, Etrazepam, Floranex, Sumavastin, Cordizem (no "-XR") |
| Distractor monographs    | Mirosartan, Sumavast, Floranase: must never appear in findings                                                                         |
| Expected evidence fields | Per finding: e.g. Pravoxil timing → `Prescribing notes` / `Standard adult dose`; Etrazolam duration → `Prescribing notes`              |

## Results: run of 2026-11-11 (LLM = **fixture**, embeddings = `Xenova/bge-small-en-v1.5`, K = 6)

Retrieval and the identity gate do not depend on the LLM, so sections 1–3 are real measurements. In section 4,
the extraction/summary/verifier text comes from **hand-authored fixtures**. Parsing, table reconciliation, retrieval,
deterministic checks, the merge and quote validation all ran for real.

### 1. Identity gate (exact / explicit alias only)

|                                            | Result           |
| ------------------------------------------ | ---------------- |
| Positives matched to the correct monograph | **5 / 5 (100%)** |
| Negatives correctly _not_ matched          | **7 / 7 (100%)** |

### 2. Why the gate is needed: ungated vector search (diagnostic only)

Query `"<name> standard adult dose frequency"` over **all** reference chunks:

| Query                                                      | Expected | Top-1 monograph           | cosine        |
| ---------------------------------------------------------- | -------- | ------------------------- | ------------- |
| Velantine / Cordizem-XR / Pravoxil / Etrazolam / Quintaxin | itself   | itself (hit@1 = **100%**) | 0.855 – 0.888 |
| **Pranixol**                                               | _none_   | **Pravoxil**              | **0.818**     |
| Velantina                                                  | _none_   | Velantine                 | 0.771         |
| Quintaxol                                                  | _none_   | Quintaxin                 | 0.827         |
| Etrazepam                                                  | _none_   | Etrazolam                 | 0.850         |
| Floranex                                                   | _none_   | Floranase                 | 0.833         |
| Sumavastin                                                 | _none_   | Sumavast                  | 0.826         |
| Cordizem                                                   | _none_   | Cordizem-XR               | 0.871         |

**Every** absent name retrieves a look-alike monograph, with scores that overlap the true matches (0.77–0.87 vs
0.86–0.89). No similarity threshold can separate them. That is why identity is decided lexically, before retrieval,
and similarity is only shown to the user as "similar name, not matched".

### 3. Targeted hybrid retrieval inside the matched monograph

The current retrieval runs one query per prescribing aspect over that monograph's field chunks only. Each query is
ranked by cosine and by full-text rank, and the rankings are fused with Reciprocal Rank Fusion (details below).

| Drug        | Expected evidence field(s)                         | Rank of evidence among top-6 | Recall@3  | Recall@6  |
| ----------- | -------------------------------------------------- | ---------------------------- | --------- | --------- |
| Velantine   | Standard adult dose                                | 2                            | 1.00      | 1.00      |
| Cordizem-XR | Standard adult dose                                | 3                            | 1.00      | 1.00      |
| Pravoxil    | Prescribing notes, Standard adult dose             | 2, 1                         | 1.00      | 1.00      |
| Etrazolam   | Prescribing notes                                  | 1                            | 1.00      | 1.00      |
| Quintaxin   | Standard adult dose, Prescribing notes, Monitoring | 2, 1, 4                      | 0.67      | 1.00      |
| **Mean**    |                                                    |                              | **0.933** | **1.000** |

Every retrieved passage belonged to the matched monograph (no cross-monograph leakage). K = 6 is the default because
K = 3 would miss Quintaxin's Monitoring field (rank 4). Deterministic checks also add the evidence field they rely on
to the LLM's passages, so a ranking miss can't hide a constraint.

#### Retrieval ablation (2026-11-11) — and why the weighting was replaced

The original retrieval was a `0.7·cosine + 0.3·ts_rank` mix with one long query. It ranked Pravoxil's
"not in the morning" note 4th (Recall@3 0.50) and had a mean Recall@3 of 0.833. Checked against the stored
queries, its full-text half did not work as intended: `websearch_to_tsquery` ANDs all ~25 query terms, so **no field
chunk matched** (0 of 18 checked), and the partial `ts_rank` scores, multiplied by 10 and capped at 1, gave five of
Etrazolam's nine fields the same lexical score while ranking Pravoxil's Contraindications above the Prescribing notes
that carry its real timing rule. It has been replaced by one query per prescribing aspect (dose, schedule, duration,
indication/contraindications), each ranked by cosine and by an OR-of-lexemes full-text rank, fused with Reciprocal
Rank Fusion (k = 60); the Contraindications field is always included. `pnpm eval` now reports all three strategies on
the same medications:

| Strategy (same queries, same chunks)      | mean Recall@3 | mean Recall@6 |
| ----------------------------------------- | ------------- | ------------- |
| Vector only                               | 0.933         | 1.000         |
| Weighted hybrid (previous)                | 0.833         | 1.000         |
| **RRF over per-aspect queries (current)** | **0.933**     | **1.000**     |

On this ten-field-per-monograph digest the lexical signal adds nothing beyond vectors (vector-only ties RRF); what
RRF fixes is that the lexical half no longer _hurts_ the ranking, and it stays meaningful for longer monographs where
exact terms ("contraindicated", "bedtime") matter. End-to-end results were unchanged by the switch.

### 4. End-to-end on the golden document (fixture LLM)

| Metric                                                                                           | Result                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Medication status accuracy                                                                       | **6 / 6** (Velantine S, Cordizem-XR C[dose], Pravoxil C[timing], Etrazolam C[duration], Pranixol U, Quintaxin S) |
| Conflict-field precision / recall                                                                | **100% / 100%**                                                                                                  |
| Extraction accuracy by field (dose, route, frequency, timing, duration, indication, source page) | **100%** each                                                                                                    |
| Citations whose quote validates in the cited chunk                                               | **100%**                                                                                                         |
| Decisive findings (conflict/consistent) with validated evidence                                  | **100%**                                                                                                         |
| Critical-point quotes validated against the primary document                                     | **100%** (14 points)                                                                                             |
| Psychiatry follow-up discrepancy preserved (critical point / summary)                            | **yes / yes**                                                                                                    |
| Findings citing distractor monographs                                                            | **0**                                                                                                            |

### 5. Robustness beyond the one sample (2026-11-11)

One golden document can't show how the checks behave on other prescriptions, or with a misbehaving model. `pnpm eval`
(section 5) and `tests/integration/robustness.test.ts` share one runner (`scripts/lib/robustness.ts`). It runs three
checks against the real indexed formulary. The model is **scripted**, so the numbers are the same in fixture and live mode.

**Prescription perturbations** (`fixtures/robustness.json`, test-only): 14 extractions as a model might return them
from other discharge summaries. They are verified with a model that takes no position, so each outcome comes from
parsing, identity, retrieval and the deterministic rules alone. Result: **14 / 14 as expected.**

| Case                                                  | Expected → measured                          |
| ----------------------------------------------------- | -------------------------------------------- |
| "Velantine 10 mg tablet", "once-daily"                | Supported (strength/form stripped from name) |
| "Pravoxil (simvastatin)" 20 mg at bedtime             | Supported (generic in brackets)              |
| Velantine "0.01 g"                                    | Supported (g → mg)                           |
| Velantine "1,000 mg"                                  | Contradicted [dose]                          |
| Pravoxil "twice-daily"                                | Contradicted [frequency]                     |
| Pravoxil "in the morning" (monograph forbids morning) | Contradicted [timing]                        |
| Etrazolam "21 days" / "6 weeks" (limit 4 weeks)       | Supported / Contradicted [duration]          |
| Quintaxin "in the morning" (rule: before breakfast)   | Incomplete [timing: meal relation unstated]  |
| Cordizem-XR 100 mg, new start unknown                 | Incomplete [dose]                            |
| Cordizem-XR "50-100 mg" (range never collapsed)       | Incomplete [dose, unit]                      |
| Velantine "5 mL" (no mg conversion)                   | Incomplete [dose, unit]                      |
| Velantine "as needed" (scheduled regimen)             | Incomplete [frequency]                       |
| "Velantina" (look-alike)                              | Unsupported                                  |

**Adversarial model** (as if a prompt injection had succeeded): the six golden extractions are verified by a model
that answers every field the same way and backs it with a fabricated quote.

| Model behaviour                     | Model claims | Fabricated claims accepted | Real contradictions kept | New contradictions | Supported on fabrication |
| ----------------------------------- | ------------ | -------------------------- | ------------------------ | ------------------ | ------------------------ |
| "yes-man": every field consistent   | 22           | **0**                      | 3 / 3                    | 0                  | 0                        |
| "alarmist": every field in conflict | 13           | **0**                      | 3 / 3                    | 0                  | 0                        |

With either model, Velantine and Quintaxin drop from Supported to **Incomplete**. The rejected claims become
`unverified` gaps rather than flipping the status either way. A lying model costs coverage, not correctness.

**Injected extraction**: a medication the model "extracts" that is not in the document (`Zentrovax 5 mg`) is
**dropped** by table reconciliation.

What this does not cover: other document layouts (the parser is only exercised on the sample PDF and DOCX), other
formularies, and real-model variance on new documents. Those need more labelled documents.

## Live-model runs (2026-11-10, LLM = **OpenAI `gpt-5.4-mini`**, reasoning effort `low`)

Same evaluation set and code paths as above, with real model inference. A full run takes about 31 s and costs
roughly US$0.06. The final run's report is [`evaluation-live.json`](evaluation-live.json). Sections 1–3 (identity
gate and retrieval) do not involve the LLM and matched the fixture run exactly.

### Final run (after the fixes listed below)

| Metric                                                                                    | Result                                                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Medication status accuracy                                                                | **6 / 6**                                                               |
| Conflict-field precision / recall                                                         | **100% / 100%** (Cordizem-XR dose, Pravoxil timing, Etrazolam duration) |
| Extraction accuracy by field (dose, route, frequency, timing, duration, indication, page) | **100%** each                                                           |
| Citations whose quote validates in the cited chunk                                        | **100%**                                                                |
| Decisive findings with validated evidence                                                 | **100%**                                                                |
| Critical-point quotes validated against the primary document                              | **100%** (11 points)                                                    |
| Psychiatry follow-up discrepancy preserved (critical point with both quotes / summary)    | **yes / yes**                                                           |
| Findings citing distractor monographs                                                     | **0**                                                                   |

### Re-run after the hardening sprint (2026-11-11)

One more live run on the final code (stricter status rules with per-field reasons, RRF retrieval, indication
applicability, validated new-start evidence, the extended summary guard). Report: [`evaluation-live.json`](evaluation-live.json).

| Check                                             | Result                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Statuses / conflict fields                        | **6 / 6**, precision and recall **100% / 100%**                                                  |
| Extraction (all fields), citations, quotes        | **100%** each                                                                                    |
| Discrepancy preserved (critical points / summary) | **yes / yes**                                                                                    |
| Summary guard warnings                            | **0**                                                                                            |
| "New start" quotes validated                      | **6 / 6** (so the Cordizem-XR titration conflict is evidenced, not inferred)                     |
| Non-decisive findings                             | all `not_constrained` (the monograph sets no rule) — none `not_stated` / insufficient / rejected |
| Model usage recorded on the job                   | **8 calls, 18,318 tokens** (11,797 prompt + 6,521 completion); cost not computed (no prices set) |
| Wall time                                         | 27.6 s                                                                                           |

Quintaxin, which one earlier run flagged as an indication conflict, stays Supported by design: the model judged the
indication "not addressed", which the status rules read as "no rule in the formulary" rather than a conflict.

### What the live runs found, and what changed

The fixtures were hand-authored, so they could not show these failures. All were found by the live runs and fixed
before the final run.

| Run(s)    | Observation                                                                                                                                                                                                                                                            | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Verification fully correct, but the document's internal discrepancy (psychiatry follow-up "in two weeks" vs "at the 8-week mark") was **lost**: the summary mentioned only two weeks, and no `document_discrepancy` point was produced. The eval had no metric for it. | Added a discrepancy metric to the eval (`documentDiscrepancies` in the test-only golden file). The summary and critical-point prompts now tell the model to compare every follow-up, lab and course length across all sections.                                                                                                                                                                                                                                                           |
| 2–4       | Summary kept both timings **3/3**; discrepancy point **1/3**. In one run the model emitted it but quote validation dropped it. In another it was labelled `follow_up`.                                                                                                 | Diagnosed with direct calls to the critical-points task. (a) A bug on our side: the prompt shows table rows as `a \| b \| c`, but page text joins cells with spaces, so faithful table quotes always failed. `\|` is now normalized as whitespace. (b) A real rejection: the model joined words from two clauses into one "quote". The prompt now asks for one short span per quote and requires the discrepancy category. 5 of 5 direct calls then produced the point with valid quotes. |
| A, B, C   | Discrepancy preserved **3/3**. Run B: Quintaxin flagged _contradicted [indication]_ because "GERD prophylaxis" is not named in the monograph's indication list (validated quote, LLM-only).                                                                            | Policy: an indication list is not exhaustive, so absence is not a contradiction. An LLM-only indication conflict now counts only when its quote states an exclusion or restriction (Contraindications field, "not for", "avoid", "only in", …). Otherwise it is shown as `not_addressed`. The rule is in both the verifier prompt and `mergeFindings` (unit-tested).                                                                                                                      |
| D (final) | All metrics above.                                                                                                                                                                                                                                                     | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Across the 8 full live runs, the **six statuses and conflict fields were correct in 7 runs**. The exception was
run B's indication false positive, now guarded deterministically. Extraction was 100% and citation validity 100%
in every run. One final run is a small sample: model output varies between runs. That is why the safeguards (quote
validation, a deterministic merge that has the final say, the identity gate) sit in code, not in the prompt.

## Known failure modes and mitigations

| Failure mode                                  | Mitigation                                                                                                                                         | Residual risk                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Look-alike drug names (Pranixol/Pravoxil)     | Lexical identity gate; similarity shown only as "not matched"                                                                                      | Real brand/generic synonyms need an explicit alias table                                                                             |
| LLM invents or paraphrases a quote            | Quote must appear verbatim (normalized) in a chunk of the _matched_ monograph, else rejected and shown as unverified                               | Very short quotes are refused (< 4 chars)                                                                                            |
| LLM claims a conflict the rules don't support | High-confidence deterministic "consistent" outranks it, and the disagreement is recorded. An LLM-only indication conflict needs exclusion language | Indication is LLM-only (semantic). Exclusions phrased without the recognized wording are shown as not addressed rather than conflict |
| Interpretive titration rule (Cordizem-XR)     | Reported as a dose conflict at **medium** confidence (low if new-start status is unknown), with the arithmetic explained                           | Depends on the "new start" extraction                                                                                                |
| Table layout variation (Word vs LibreOffice)  | Relative gutters + alignment validation + first-column row grouping; tests on both renderings                                                      | Tables without a first column per row, rotated tables, scanned PDFs (no OCR)                                                         |
| Document discrepancy missed or mislabelled    | Prompted cross-section comparison; a discrepancy needs ≥ 2 validated quotes; eval metric                                                           | Model-dependent: 5/5 direct calls and 4/4 full runs after the fix                                                                    |
| Model unavailable / refused / truncated       | Classified, retried with backoff (retryable), stage → failed with a user-facing message                                                            | Fixture mode only covers the bundled sample                                                                                          |
