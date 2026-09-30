# ERP 3.1 — Ranpal AI Examiner Advanced + Connected Campus

Status: software implementation complete (100%); production activation gated by certification/UAT
Base: ERP/LMS 3.0 production merge e24ff542df9c76f35e9d574b5bb9964da5c19b37
Branch: integration/erp3.1-examiner-connected-campus
Verified software head: a8aaed603833f4ac3bb48bf20b0db580667b065c
Verified CI: #1083 SUCCESS

## Current release state

All eight ERP/LMS 3.1 software gates (3.1A–3.1H) are implemented and the software readiness calculation reports 100%.

Production activation is intentionally separate from software completion. It remains blocked until applicable external release evidence is completed:
- staging integration/UAT,
- real-device certification for each active hardware device and adapter,
- benchmark-ready AI Examiner runs plus approved AI grading certification for active suites,
- active privacy/retention policy coverage for all required connected-campus purposes,
- approved security/privacy certification.

These gates are enforced by the Connected Campus governance readiness API and are visible in the Super Admin Connected Campus readiness dashboard. No connector or AI grading mode should be represented as production-certified until its required evidence is recorded and approved.


## Product thesis

Build a unified school operating system that combines:
1. high-trust AI assessment and marking,
2. ERP/LMS/CRM academic operations,
3. biometric/RFID/device attendance,
4. smart transport and student ridership,
5. school/bus video integration,
6. emergency, visitor and access workflows,
7. parent-facing safety visibility,
without weakening human review, tenant isolation, auditability or child privacy.

## Competitive signals reviewed

Assessment:
- CoGrader: rubric-aligned first-pass grading, teacher approval, handwriting, LMS sync, class analytics and AI-writing flags.
- Gradescope: fixed-template answer grouping, AI-assisted grouping, rubric grading, annotations and regrade workflows.
- Inspera/Graide: end-to-end author/deliver/monitor/grade, item banks, 25+ question types, secure/proctored delivery, collaborative/double-blind grading, STEM/essay AI grading.
- TAO: scalable item banking, adaptive testing and item statistics including difficulty/discrimination.
- Remark OMR: scanner/copy-machine workflows, automatic form identification/barcodes, exception review and objective-test analytics.

School ERP / connected campus:
- Entab CampusCare: ERP, GPS transport, RFID/biometric boarding, parent alerts, attendance and payroll integration.
- Fedena: school ERP with biometric attendance integration.
- Teachmint: GPS transport tracking and parent delay/emergency notifications.
- MyClassboard: GPS plus RFID student transport attendance and parent notifications.

Safety / fleet / video:
- Here Comes The Bus: parent bus location/status alerts, scan-on/off notifications and ride cancellation.
- Geotab/Treker: GPS, student ridership, driver behavior, maintenance/diagnostics, route performance and dashcam workflows.
- Verkada/Rhombus: unified cameras, access control, sensors, visitor/intercom and AI-assisted incident search.
- Raptor: visitor management, emergency management, staff/student accountability and reunification.

## Release train

### 3.1A — Ranpal AI Examiner Advanced
Goal: category-grade AI assessment for Play/Nursery/KG through Class 12 and competitive exams.

Capabilities:
- Assessment-type router: deterministic, symbolic/numeric, rubric-semantic and multimodal engines.
- Deterministic MCQ/MSQ/true-false/matching/assertion-reason/fill-in scoring.
- Negative marking, partial marking, integer/decimal/numerical-answer tolerances.
- Mathematics/Physics symbolic equivalence, units, sign, significant-figure and step-marking checks.
- Chemistry equation/reaction/balancing/structure checks.
- Accounting tabular/ledger/final-account checks.
- Programming/code answer support with sandboxed test-case evaluation where appropriate.
- Language/humanities rubric-semantic scoring with evidence-linked deductions.
- Diagram, graph, map, geometry construction and labelled-figure evaluation.
- Oral/audio/video response assessment where explicitly configured.
- Early-years modes: tracing, matching, shapes, letter/number formation and teacher-observation rubrics.
- Board/exam profiles: CBSE, ICSE/ISC, JEE Main/Advanced, NEET, NDA, CUET and institution-defined exams.
- Configurable marking schemes by exam profile, including JEE/NEET-style negative marking.
- Question-paper blueprint, syllabus/outcome mapping and item-bank authoring.
- AI question generation with teacher approval, duplicate/similarity detection and difficulty tagging.
- Bulk class-set scanning from copier/scanner PDFs.
- Automatic paper/student/page identification using QR/barcode/cover-page mapping.
- Deskew, rotate, page-order validation, duplicate/missing-page detection and quality triage.
- OMR engine with exception review.
- Anonymous/blind/double-blind/committee grading modes.
- Moderation, standardisation and second-review workflows.
- Regrade/appeal workflow with full audit history.
- Confidence thresholds by subject/question type.
- Evidence-linked AI rationale per rubric criterion.
- Second-pass verifier for high-stakes or low-confidence responses.
- Benchmark suite against human-marked scripts; release gates by class/subject/question type.
- AI-human agreement, override-rate and drift dashboards.
- Item analysis: difficulty, discrimination, distractor analysis, reliability and outcome mastery.
- Student/class/topic/skill analytics and remedial recommendations.
- Originality/plagiarism/AI-writing signals as review evidence, never automatic guilt decisions.
- Secure exam delivery: attempt controls, timer, accommodations, question/option shuffle, lockdown/proctoring adapters.
- Offline/network-resilient exam delivery for labs/test centres.
- Accessibility and multilingual/vernacular support.

### 3.1B — Device Integration Hub
Goal: one vendor-neutral gateway for campus devices.

Capabilities:
- Connector SDK and adapter registry.
- Being Brilliant Edge Agent for LAN-only hardware.
- Device registration, ownership, branch mapping and secure credentials.
- Heartbeat, online/offline state, last sync, event lag and queue depth.
- Signed outbound event transport; no public inbound device exposure by default.
- Replay-safe idempotency, deduplication and raw-event audit.
- Firmware/model/vendor/capability inventory.
- Remote diagnostics and connector health.
- Webhooks/MQTT/HTTP/push/file-import adapter patterns.
- Per-tenant device quotas and commercial entitlements.

### 3.1C — Biometric / RFID / Access
- Employee, teacher and student device identity mapping.
- Attendance IN/OUT reconciliation, duplicate-punch suppression and shift rules.
- Multiple gates/device zones.
- Offline event backlog and reconciliation.
- RFID/NFC/QR alternatives for students.
- Gate access logs and optional door/access-control adapters.
- Parent instant arrival/departure notifications.
- Guardian-authorized pickup using QR/OTP plus approval workflow.
- Visitor management: pre-registration, host approval, badge, check-in/out and visit history.
- Contractor/vendor entry workflows.
- Avoid storing biometric templates in SaaS by default; store attendance events and device identifiers.

### 3.1D — Smart Transport & Ridership
- Live GPS ingestion via vendor adapters and AIS-140-compatible provider integrations.
- Map view, route progress, stop ETA, trip replay and geofences.
- Route deviation, overspeed, unauthorized halt, late start and device-offline alerts.
- Student boarding/alighting via RFID/NFC/QR/biometric adapter.
- "Bus approaching", "boarded", "arrived school", "dropped" parent notifications.
- Parent ride cancellation / transport absence.
- Driver app with trip checklist, navigation and emergency/SOS.
- Driver behavior and harsh braking/acceleration/event ingestion where telematics supports it.
- Preventive maintenance, diagnostics, fuel/energy, service reminders and DVIR.
- EV bus battery/range/charging telemetry where available.
- Substitute bus/driver reassignment.
- Route optimization and capacity planning.
- Student exception detection: boarded wrong bus, missed expected stop, still onboard after route end.

### 3.1E — Campus Vision / Video
- ONVIF-first camera/NVR discovery and capability abstraction.
- RTSP ingestion only inside trusted edge/network boundary; browser delivery via authorized short-lived sessions.
- Live view, multi-camera wall, camera groups, campus/building/floor maps.
- Bus front/cabin camera linkage to vehicle and trip.
- Recording search, bookmarks, incident clips and retention policies.
- Watermarking, RBAC, export audit and privacy masks.
- Motion/tamper/offline alerts.
- Optional analytics adapters for intrusion, crowding, line crossing, restricted areas, smoke/fire-compatible events and vehicle/person search.
- Face recognition/child identification is not a default feature and requires separate explicit governance.

### 3.1F — School Safety Command Center
- Unified live operations dashboard: students, staff, gates, buses, cameras, incidents and device health.
- Student Safety Timeline: gate entry -> classroom attendance -> bus boarding -> school arrival -> bus drop.
- Missing-transition alerts when expected events do not occur.
- Emergency/SOS/panic workflows with role-based escalation.
- Lockdown/evacuation/drill workflows.
- Staff/student/visitor accountability during emergencies.
- Parent mass notification and acknowledgement.
- Reunification workflow for guardian release.
- Incident case management with timeline, evidence, notes and follow-up.
- Floor/campus maps and zone-based alerts.
- Environmental sensor adapters: smoke, temperature, CO2, air quality, water leak and power.
- Optional nurse/medical emergency handoff without exposing unnecessary health information.

### 3.1G — Identity, Privacy, Security & Compliance
- Unified digital identity for student/staff/guardian/device relationships.
- Fine-grained RBAC/ABAC for video, transport, attendance and assessment.
- Consent and privacy centre with purpose, retention and sharing controls.
- Child-data minimisation and configurable retention.
- Immutable audit events for grades, device events, video access/export and emergency actions.
- Encryption, secret rotation, signed device events and tenant isolation.
- Data residency/export/deletion controls.
- Security monitoring and device anomaly detection.
- Admin-visible integration health and compliance dashboard.

### 3.1H — Parent / Mobile Experience
- One parent app for academics, attendance, fees, transport and safety.
- Multi-child switching.
- Live bus ETA and ride cancellation.
- Arrival/departure/boarding/drop alerts.
- Authorized pickup management.
- Emergency acknowledgements.
- Report card, AI feedback and remedial learning plan.
- Language/localisation support.
- Fine-grained parent notification preferences.

## Differentiators to protect

1. One event graph connecting academic, identity, attendance, transport and safety data.
2. Human-approved, evidence-linked AI grading rather than opaque auto-marking.
3. Vendor-neutral hardware connectors instead of dependence on one biometric/GPS/camera brand.
4. Edge-first architecture for school LAN devices and cameras.
5. Parent-facing safety timeline driven by verified events.
6. High-stakes assessment benchmark and calibration framework.
7. Modular commercial packaging: Examiner, Smart Transport, Connected Campus, Campus Vision and full SchoolOS.

## Release gates

No production release of a connector or AI grading mode until:
- automated tests are green,
- staging integration tests pass,
- tenant/branch authorization is verified,
- audit trail is verified,
- failure/offline/retry behavior is verified,
- privacy/security review is complete,
- hardware adapter has a real-device certification test where applicable,
- AI grading mode meets an agreed human-agreement/override benchmark for its subject/question type.
