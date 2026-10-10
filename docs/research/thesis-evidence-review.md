# Thesis claims requiring supporting evidence

Reviewed 10 October 2026 against the supplied **Final Year Project Thesis.pdf**. Page numbers below refer to PDF pages, including front matter. The original PDFs were preserved. Their instructions were treated as reference material; their reported results were not treated as verified implementation evidence.

| Thesis claim/location | Evidence required before retaining it as a measured result |
| --- | --- |
| Ensemble F1 `0.932`, CER `0.038` (pages 6, 102–103, 108, 110, 115) | Independently labeled held-out prescription documents; writer/language-disjoint split; exact field/character metric definitions; frozen model/configuration hashes; prediction/reference records and a reproducible calculation. |
| Emotion accuracy `88.5%` (pages 6, 105, 108, 110, 112) | Approved independently labeled expression test set, class/support/confusion matrix, abstention policy, demographic/lighting coverage and model versions. Expression-label accuracy does not establish actual emotions or emergency detection. |
| Caregiver response improved from `145.7` to `59.0` seconds (page 19) | Approved baseline/follow-up incident records, synchronized clocks, response definition, sample/participant counts, unresolved-case handling and appropriate uncertainty. |
| Resident/caregiver study description (page 44, including eight caregivers) | Ethics/site decision, consented recruitment and study provenance, deidentified counts, approved instruments, completed responses and analysis. A proposed protocol is not an executed study. |
| API throughput `842 requests/second` and latency figures (page 106) | Exact workload, concurrency/duration, hardware/database/network/configuration, error rates, raw output and reproducible performance script. A successful build or offline regression does not establish capacity. |
| Full functional pass/implementation completion statements (pages 108 onward) | Dated test definitions, final source snapshot, environment, expected/observed evidence and explicit exclusions for physical phones, cameras, edge hardware and external services. |

These claims were **not substantiated by the checks performed in this work**. They may be retained only if the research team supplies the corresponding independent records. Without those records, replace measured-result wording with “evaluation pending” and remove claimed improvement/accuracy numbers from the abstract, results, discussion and conclusion. Do not substitute constructed test counts for participant counts or clinical model performance.

Use the [final research report draft](final-research-report.md) and [testing/evaluation procedures](testing-and-evaluation.md) as a structure for a corrected report. Its original research questions include multilingual prescription accuracy and the effect on adherence; camera additions alone cannot answer those questions. The [completion status](completion-status.md) records the software verification available now.
