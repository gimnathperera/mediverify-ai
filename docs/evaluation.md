# RAG evaluation

Reproduce with `pnpm eval` (fixture LLM) or `pnpm eval:live` (OpenAI; needs `OPENAI_API_KEY`). Each run writes
JSON with `--out <file>`. CI runs the fixture evaluation on every push and keeps `eval-report.json` as an artifact.
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

## Results: run of 2026-11-09 (LLM = **fixture**, embeddings = `Xenova/bge-small-en-v1.5`, K = 6)

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

0.7·cosine + 0.3·full-text rank, over that monograph's field chunks only.

| Drug        | Expected evidence field(s)                         | Rank of evidence among top-6 | Recall@3  | Recall@6  |
| ----------- | -------------------------------------------------- | ---------------------------- | --------- | --------- |
| Velantine   | Standard adult dose                                | 1                            | 1.00      | 1.00      |
| Cordizem-XR | Standard adult dose                                | 1                            | 1.00      | 1.00      |
| Pravoxil    | Prescribing notes, Standard adult dose             | 4, 1                         | 0.50      | 1.00      |
| Etrazolam   | Prescribing notes                                  | 3                            | 1.00      | 1.00      |
| Quintaxin   | Standard adult dose, Prescribing notes, Monitoring | 1, 3, 4                      | 0.67      | 1.00      |
| **Mean**    |                                                    |                              | **0.833** | **1.000** |

Every retrieved passage belonged to the matched monograph (no cross-monograph leakage). This is why K = 6 is the
default: K = 3 would miss Pravoxil's "not in the morning" note. Deterministic checks also add the evidence field
they rely on to the LLM's passages, so a ranking miss can't hide a constraint.

### 4. End-to-end on the golden document (fixture LLM)

| Metric                                                                                           | Result                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Medication status accuracy                                                                       | **6 / 6** (Velantine S, Cordizem-XR C[dose], Pravoxil C[timing], Etrazolam C[duration], Pranixol U, Quintaxin S) |
| Conflict-field precision / recall                                                                | **100% / 100%**                                                                                                  |
| Extraction accuracy by field (dose, route, frequency, timing, duration, indication, source page) | **100%** each                                                                                                    |
| Citations whose quote validates in the cited chunk                                               | **100%**                                                                                                         |
| Decisive findings (conflict/consistent) with validated evidence                                  | **100%**                                                                                                         |
| Critical-point quotes validated against the primary document                                     | **100%** (14 points)                                                                                             |
| Findings citing distractor monographs                                                            | **0**                                                                                                            |

### Live-model run

**Not yet run.** It needs `OPENAI_API_KEY`. Run `pnpm eval:live --out eval-live.json` (with Postgres up) and paste the
summary here. Until then, nothing in this repository claims how live model extraction or summarization performs.

## Known failure modes and mitigations

| Failure mode                                  | Mitigation                                                                                                               | Residual risk                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Look-alike drug names (Pranixol/Pravoxil)     | Lexical identity gate; similarity shown only as "not matched"                                                            | Real brand/generic synonyms need an explicit alias table                     |
| LLM invents or paraphrases a quote            | Quote must appear verbatim (normalized) in a chunk of the _matched_ monograph, else rejected and shown as unverified     | Very short quotes are refused (< 4 chars)                                    |
| LLM claims a conflict the rules don't support | High-confidence deterministic "consistent" outranks it, and the disagreement is recorded                                 | Indication is LLM-only (semantic)                                            |
| Interpretive titration rule (Cordizem-XR)     | Reported as a dose conflict at **medium** confidence (low if new-start status is unknown), with the arithmetic explained | Depends on the "new start" extraction                                        |
| Table layout variation (Word vs LibreOffice)  | Relative gutters + alignment validation + first-column row grouping; tests on both renderings                            | Tables without a first column per row, rotated tables, scanned PDFs (no OCR) |
| Model unavailable / refused / truncated       | Classified, retried with backoff (retryable), stage → failed with a user-facing message                                  | Fixture mode only covers the bundled sample                                  |
