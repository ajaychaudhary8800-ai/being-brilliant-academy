# SchoolOS V5 RC7 — LMS native LiveKit token bypass protection

The V4 LMS `POST /learning/live-classes/native/:room/session` issues direct LiveKit tokens without a SchoolOS prepaid reservation, because native `LiveClass` is not a `Meeting`. A tenant paying for V5 metered video minutes could bypass video-minute reservations, quota cutoff, signed provider attendance and finance settlement by launching legacy LMS native live classes.

**Immediate fail-closed control:** if `schoolOSVideoAdmissionEnabled(organizationId)` is true, reject native LMS LiveClass token issuance and its legacy attendance-join route with HTTP 409 `SCHOOLOS_VIDEO_NATIVE_CLASS_UNMETERED`. The authorized customer can use the independently quota-gated `/meetings/native/:room/session` endpoint instead. Neither an unrecorded room nor its attendance may silently consume unpaid quota.

All V4 tenants and V5 tenants without video-metering explicitly enabled retain the native LMS classroom and the original attendance path unchanged. This fixes a billing bypass; it intentionally does NOT claim that arbitrary LMS LiveClasses are prepaid and it does NOT introduce a paid capture or network provider call. Future full metered-LMS support would require a separate documented reservation/settlement lifecycle and live staging UAT.

**Acceptance:** source-order contract tests enforce the check before token signing and before attendance upsert. Exact-head GitHub CI and disposable PostgreSQL sandbox must pass; real-provider UAT remains an independent pending commercial gate. No shared staging or production deployment authorized.
