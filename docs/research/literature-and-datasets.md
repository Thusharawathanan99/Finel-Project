# Literature review and dataset access plan

Primary bibliographic pages and the linked AffectNet agreement were checked on 10 October 2026. A checked paper is evidence for its own method, not evidence for this project's accuracy or safety. The proposal's placeholder references and asserted caregiver-response improvement are not reproduced as established results.

## Literature synthesis

Large action datasets provide reusable representations but do not directly validate older residents, falls or institutional routines. UCF101 describes 101 action categories from unconstrained videos [1]. Kinetics describes a human-action benchmark with short clips and diverse interactions [2]. Their relevance here is a possible source of representation learning or compatible activity examples; fine-grained care events need explicit label mapping and independent local validation.

Temporal reasoning matters. TSN samples across a video to learn longer temporal structure [3], while I3D extends image convolution filters into spatiotemporal filters [4]. These papers support testing complete transitions rather than labelling every horizontal frame a fall. Their published benchmark scores are not transferable project results. ST-GCN learns spatial and temporal skeleton patterns [5], offering a future sequence-model comparator. This repository instead implements a small pose-feature classifier and transparent temporal rules suited to an initial edge prototype.

BlazePose describes an on-device pose network with 33 keypoints for a single person [6]. The project's multipose adapter and geometric tracking add an implementation layer; anonymous track continuity is not resident identification. Device speed and occlusion performance must be measured on the intended camera and hardware.

AffectNet provides expression categories and valence/arousal annotations in natural images [7]. The representation-learning contest report documents the facial-expression challenge associated with FER2013 [8]. These support expression-model benchmarking, but dataset expression annotations do not establish a resident's feelings or health. Age, illumination and cultural coverage must be reported. The project keeps visible-expression output separate from deliberate wellness self-report and caregiver decisions.

Donut treats document understanding as image-to-structured-output prediction without an external OCR stage [9]. TrOCR uses pretrained image/text Transformers for text recognition [10]. They support a prescription experiment comparing OCR-based and OCR-free extraction. Neither paper establishes reliable Tamil/Sinhala prescriptions in this repository. Medicine, dose, timing and food instructions require independent reference annotation and source-image review; multilingual test strata must be reported separately.

The research contribution to evaluate is integration: privacy-aware observation, verified prescription scheduling and accountable care response in a constrained environment. Whether integration improves adherence or responsiveness remains an empirical question. All ten sources inform design or comparators; they do not substitute for the proposed primary study.

## References

1. K. Soomro, A. R. Zamir and M. Shah, “UCF101: A Dataset of 101 Human Actions Classes From Videos in The Wild,” 2012. [Primary paper](https://arxiv.org/abs/1212.0402).
2. W. Kay et al., “The Kinetics Human Action Video Dataset,” 2017. [Primary paper](https://arxiv.org/abs/1705.06950).
3. L. Wang et al., “Temporal Segment Networks: Towards Good Practices for Deep Action Recognition,” ECCV, 2016. [Primary paper](https://arxiv.org/abs/1608.00859).
4. J. Carreira and A. Zisserman, “Quo Vadis, Action Recognition? A New Model and the Kinetics Dataset,” 2017; revised 2018. [Primary paper](https://arxiv.org/abs/1705.07750).
5. S. Yan, Y. Xiong and D. Lin, “Spatial Temporal Graph Convolutional Networks for Skeleton-Based Action Recognition,” AAAI, 2018. [Primary paper](https://arxiv.org/abs/1801.07455).
6. V. Bazarevsky et al., “BlazePose: On-device Real-time Body Pose tracking,” 2020. [Primary paper](https://arxiv.org/abs/2006.10204).
7. A. Mollahosseini, B. Hasani and M. H. Mahoor, “AffectNet: A Database for Facial Expression, Valence, and Arousal Computing in the Wild,” IEEE Transactions on Affective Computing, vol. 10, no. 1, pp. 18–31, 2019; preprint 2017. [Primary paper](https://arxiv.org/abs/1708.03985), [DOI](https://doi.org/10.1109/TAFFC.2017.2740923).
8. I. J. Goodfellow et al., “Challenges in Representation Learning: A report on three machine learning contests,” 2013. [Primary paper](https://arxiv.org/abs/1307.0414).
9. G. Kim et al., “OCR-free Document Understanding Transformer,” ECCV, 2022; preprint 2021. [Primary paper](https://arxiv.org/abs/2111.15664).
10. M. Li et al., “TrOCR: Transformer-based Optical Character Recognition with Pre-trained Models,” 2021; revised 2022. [Primary paper](https://arxiv.org/abs/2109.10282).

## Dataset licence and access review

**No research dataset was downloaded, relabelled, redistributed, or used to train a model as part of preparing this dossier.** Paper publication and a model/code licence do not grant permission for every underlying image or video. Recheck the actual release terms at acquisition time and retain the institution's review decision.

| Candidate | Permitted project use to assess | Current review decision |
| --- | --- | --- |
| UCF101 | Compatible action clips or pretraining comparator; not an elderly fall benchmark | Pending review of exact release, provider terms, source video rights and label mapping. Consult the [UCF primary paper](https://arxiv.org/abs/1212.0402) and provider; provider page retrieval did not complete during this review. No licence inferred. |
| Kinetics | Transfer-learning/sequence comparator; compatible movement subset | Pending exact version, access and underlying-video review. The [maintainer repository](https://github.com/cvdfoundation/kinetics-dataset) warns that split overlap across releases can invalidate evaluation. Preserve release and original video IDs. |
| CASIA gait datasets | Gait/movement comparator if the selected release fits the task | Pending institution/provider permission and exact subset agreement. The proposal names CASIA without a release. Do not assume a gait identity dataset supplies fall labels or consent for resident identification. |
| FER2013 | Separate expression benchmark | Pending original challenge/release terms, permitted storage and publication rights. Use the [original contest report](https://arxiv.org/abs/1307.0414); do not rely on a mirror's licence alone. |
| AffectNet | Separate expression benchmark, only under approved academic access | Requires supervisor-led review and access agreement before acquisition; see below. No public mirror/relicensed copy accepted without provenance. |
| Sri Lankan volunteer pose features | Independent local evaluation and optional training | University approval, site permission and explicit research consent first; pseudonymized features preferred. No older adult is asked to perform a fall. |
| Prescription examples | OCR/NLP field extraction and multilingual comparison | Review source permissions, remove identifiers, obtain research-use authority, and have reference fields independently checked. Synthetic samples may test software but cannot establish clinical accuracy. |

The [AffectNet Academic Use Agreement v2.1, 10 May 2024](https://mohammadmahoor.com/wp-content/uploads/2024/06/AffectNet-Agreement-v2.1-10May2024.pdf) requires an academic principal to request access for trainees and list permitted researchers. It restricts use to noncommercial research/education, institutional computers and permitted researchers, prohibits third-party redistribution, and requires applicable institutional review before the request. The supervisor must review the complete agreement and any current replacement. A repository licence or public dataset mirror does not override it.

## Provenance ledger required before use

For every approved source, record: release/version, provider URL, acquisition date, licence/agreement hash, permitted researchers, storage location, institution decision, redistribution restrictions, ethics/consent reference, label mapping, deletion deadline, original recording ID and SHA-256. Keep signatures and direct identifiers in a separate restricted ledger. Never place identifiable media, signed consent or provider credentials in Git.

## Reproducible split and training plan

1. Obtain independent labels from observation/reference annotation. Labels copied from the system's own heuristic cannot measure that heuristic's accuracy.
2. Prepare JSONL with `sampleId`, pseudonymous `participantId`, original `recordingId`, original-content `contentHash`, `label`, and finite measured `features`. Keep overlap and licence evidence outside the public manifest.
3. Group participant, original recording and duplicate content before approximately 70/15/15 train/validation/test assignment. Apply grouping before clipping/augmentation. Manually review near duplicates, shared subjects and cross-release overlap.
4. From `7-monitoring`, run `python -m research.split approved-manifest.jsonl --output approved-split.jsonl`, then `python -m research.split approved-split.jsonl --verify --output verified-split.jsonl`.
5. Run `python -m research.train_activity verified-split.jsonl --output-dir results/experiment-001`. The optional trainer fits training-only standardization and balanced logistic regression. Record seed, manifest/model hashes, features, library versions, abstention threshold and all failed experiments.
6. Freeze the artifact and thresholds before final test evaluation. Report class support, confusion matrix, precision/recall/F1, accuracy and coverage with abstentions included. Use full sequence trials separately for fall/inactivity. Do not deploy arbitrary serialized `joblib` files; only use a trusted audited local artifact.
7. Evaluate expression/OCR independently with their own participant/document groups. Never tune on the final held-out cohort. Keep consent withdrawals and deleted samples consistent across manifests, model-use decisions and exports.

Minimum groups required by a splitter are a software requirement, not a defensible research sample size. The [study protocol](data-collection-protocol.md) defines the proposed recruitment and uncertainty reporting. Actual training, approved datasets and numerical performance remain pending.
