# Step 10 — SaaS Lead Generation & Conversion Playbook

**Product:** Being Brilliant ERP + LMS + CRM  
**Owner:** Platform commercial team  
**Effective:** 25 September 2026

This playbook converts the commercial packaging from Step 8 and the contract pack from Step 9 into a repeatable client-acquisition process.

## 1. Sales objective

Build a measurable B2B funnel that moves institutions through:

**Target Account → New Lead → Qualified → Contacted → Demo Scheduled → Demo Completed → Proposal Sent → Negotiation → Won / Lost / Nurture**

A lead is not "won" until the paying customer organization has been created in the SaaS platform and linked to the lead.

## 2. Initial ideal customer profiles

### ICP A — Independent schools

Primary launch profile:
- CBSE/CISCE/private schools.
- Approximately 300–2,000 active students.
- Owner/director/principal-led buying process.
- Manual/spreadsheet-heavy administration or fragmented software.
- Need at least two of fees, attendance, academics, LMS, admissions CRM, examinations or parent/student access.
- North India/NCR can be prioritized operationally at launch, but the product is not geographically restricted.

Recommended plans:
- Core ERP only and <=300 students: Essentials.
- Single-campus school needing LMS/CRM/exams: Growth.
- Multi-campus or HR/finance/library/inventory/analytics: Professional.
- White-label/custom domain/transport/hostel/large group: Enterprise.

### ICP B — Coaching institutes

- 200–3,000 active learners.
- Multiple batches/courses and frequent fee/attendance/test operations.
- Strong need for LMS, homework/tests, CRM/enquiry follow-up and communication.
- Owner/director is accessible and sales cycle can be shorter than a school group.

Default fit: Growth or Professional.

### ICP C — Multi-branch education groups

- Multiple schools/coaching/training branches.
- Central management wants consolidated controls/reporting.
- Requires Professional or Enterprise because standard Essentials/Growth are single-branch.

### ICP D — Training / skill institutes

- Recurring batches/programs.
- Lead/admission pipeline plus attendance, fees, LMS and certification workflows.
- Growth for single location; Professional for multi-location/HR/finance.

## 3. Disqualification / low-priority rules

Do not spend high-touch sales time where:
- institution has fewer than ~100 active learners and no strategic expansion;
- buyer only wants one tiny isolated feature at commodity pricing;
- procurement requires certifications/DR commitments we do not currently offer;
- requested deployment requires unsupported statutory integrations before purchase;
- buyer refuses to identify a decision-maker or business problem after reasonable discovery;
- project is a government tender requiring a separate tender/compliance motion;
- requested price is below a sustainable commercial floor without strategic approval.

Move long-term opportunities to NURTURE rather than repeatedly chasing them.

## 4. Approved lead sources

### Tier 1 — Official institution directories

1. **CBSE SARAS School Directory** — use state/district filters to build named-school target accounts.
   Reference: https://saras.cbse.gov.in/SARAS/AffiliatedList/ListOfSchdirReport

2. **CISCE School Locator** — use location filters to build ICSE/ISC target accounts.
   Reference: https://locate.cisce.org/

Use institutional/public business contact details. Do not build lists from private/personal data obtained without a legitimate business purpose.

### Tier 2 — Local discovery

- Google Business Profile / Maps for coaching centres, training institutes and schools.
- Institution websites/contact pages.
- Public LinkedIn organization pages and publicly presented business decision-makers.
- Education associations and school-group directories.
- Sahodaya/ASISC and similar institutional networks/events where participation/contact is legitimate.

### Tier 3 — Warm channels

- Existing institutional relationships.
- Referral partners.
- Education consultants.
- Teacher/recruitment networks.
- Existing customers and friendly institutions.
- Professional events, seminars and training programmes.

### Tier 4 — Inbound

- Website product-demo form.
- Organic search.
- Social campaigns.
- Direct referrals.
- Partner campaigns.

Every source must be recorded in the SaaS Sales pipeline.

## 5. Lead data standard

Minimum:
- organization name;
- contact name or role;
- public business mobile/phone;
- institution type;
- source.

Strongly preferred:
- business email;
- city/state;
- website;
- approximate student count;
- key requirement/pain point;
- decision-maker role;
- existing system/manual process;
- timeline;
- next follow-up date.

Never store passwords, unnecessary identity documents, sensitive personal data or unrelated private information in sales notes.

## 6. Platform lead stages

### NEW
Created but not yet researched/contacted.

Exit:
- basic institutional validation completed;
- first action scheduled.

### QUALIFIED
Initial fit is credible based on institution size, needs or strategic value.

Exit:
- first contact attempted/completed.

### CONTACTED
Two-way or meaningful outbound interaction started.

Exit:
- demo scheduled, nurture or loss decision.

### DEMO_SCHEDULED
Date/time agreed.

Exit:
- demo completed or rescheduled.

### DEMO_COMPLETED
Decision-maker/team has seen relevant workflows.

Exit:
- proposal sent, nurture or lost.

### PROPOSAL_SENT
Written commercial proposal/order package issued.

Exit:
- negotiation, won, lost or nurture.

### NEGOTIATION
Commercial/contract/scope negotiation active.

Exit:
- won or lost.

### WON
Commercial agreement/payment condition met and customer organization exists.

Requirement:
- populate `wonOrganizationId`.
- hand off immediately to Step 7 onboarding.

### LOST
Opportunity closed without sale.

Requirement:
- record `lostReason`.

### NURTURE
Potential fit, but not active buying cycle.

Requirement:
- set a future follow-up date.

## 7. Qualification

System-generated lead score is a prioritization aid, not an automatic sales decision.

### MQL
Marketing-qualified when:
- credible institution;
- meaningful size/need;
- usable contact information;
- relevant product interest.

The platform may automatically mark higher-scoring inbound leads as MQL.

### SQL
Sales-qualified only after human discovery confirms:
1. **Fit** — our product solves the requested workflows.
2. **Scale** — plan/capacity can support the institution.
3. **Need** — problem is material enough to change software/process.
4. **Authority** — decision-maker or procurement path is identified.
5. **Timing** — plausible buying/implementation window exists.

### DISQUALIFIED
No current fit, fake/spam, invalid institution or incompatible requirement.

## 8. Standard outbound cadence

Do not spam. Stop/escalate cadence when the recipient asks not to be contacted.

**Day 0:** Research account and send first relevant business contact message/email.  
**Day 1–2:** Phone call / business WhatsApp where appropriate.  
**Day 4:** Send a short use-case follow-up with one relevant outcome.  
**Day 7:** Second call or email; offer a 20–30 minute tailored demo.  
**Day 14:** Final active-cycle follow-up.  
**Day 30:** Move to NURTURE unless active engagement exists.

For warm referrals, contact within one business day.

Each meaningful touch must be logged as CALL, EMAIL, WHATSAPP, MEETING, DEMO, PROPOSAL or NOTE.

## 9. Outreach messaging framework

Do not lead with a long feature list.

Use:
1. institution-specific observation;
2. operational problem;
3. concise platform outcome;
4. low-friction CTA.

Example structure:

> We work with education institutions that want admissions, fees, attendance, academics, LMS and management reporting in one system rather than separate tools. If [Institution] is reviewing its ERP/LMS process, I can show the workflows relevant to your current setup in a 20-minute demo.

Do not claim a client/reference, saving percentage or compliance certification unless verified.

## 10. Discovery call

Target: 15–25 minutes.

Ask:
- institution type and branches;
- active students/users;
- current ERP/software/manual process;
- biggest administrative pain points;
- modules currently used;
- admissions/enquiry workflow;
- fee/collection workflow;
- LMS/homework/exam needs;
- parent/student/teacher portal needs;
- HR/finance/library/transport/hostel needs;
- reporting requirements;
- migration requirement/source system;
- desired go-live timing;
- decision-maker/procurement steps;
- budget range only after value/scope context.

Immediately update qualification, recommended plan, annual value and next action.

## 11. Demo workflow

Target: 30–45 minutes.

### Before demo
- review discovery notes;
- choose 3–5 workflows that matter;
- prepare a clean demo tenant;
- avoid showing irrelevant modules.

### Demo agenda
1. Client pain recap — 3 minutes.
2. Management dashboard / role model — 5 minutes.
3. Top two critical workflows — 15 minutes.
4. Secondary modules / reporting — 10 minutes.
5. Implementation and migration — 5 minutes.
6. Commercial fit and next step — 5 minutes.

### Demo exit
A successful demo ends with a dated next action:
- proposal required;
- second stakeholder demo;
- technical/security review;
- nurture date; or
- explicit no-fit/lost reason.

Never leave "we will follow up sometime."

## 12. Proposal and negotiation

For an SQL with agreed scope:
- issue proposal/quotation within one business day after the final qualified demo;
- use Step 8 standard price list;
- use Step 9 controlled legal documents;
- record expected annual contract value;
- schedule proposal review rather than only emailing documents;
- record all exceptions explicitly.

No salesperson may unlock modules, exceed capacity or promise unsupported infrastructure outside the contracted plan.

## 13. Closing rules

Mark WON only when:
- scope/plan is approved;
- commercial acceptance/order form exists;
- required payment/activation condition is met;
- production customer organization has been or is being provisioned;
- `wonOrganizationId` is recorded.

Then hand off to:
**Step 7 Client Onboarding → Implementation SOW → UAT → Go-live.**

## 14. Lost-reason taxonomy

Use concise standardized reasons in notes:
- PRICE
- NO_BUDGET
- NO_URGENCY
- COMPETITOR
- EXISTING_SYSTEM_RETAINED
- MISSING_FEATURE
- PROCUREMENT_BLOCKED
- NO_DECISION
- TOO_SMALL
- SECURITY_COMPLIANCE_GAP
- OTHER

Review lost reasons monthly to guide product and positioning decisions.

## 15. Weekly operating rhythm

### Daily
- clear overdue follow-ups first;
- process inbound leads;
- research/add target accounts;
- execute today's outreach;
- log every material activity;
- ensure every active lead has a next action/date.

### Monday
- review pipeline by stage/source;
- set account/outreach goals;
- prioritize SQLs and overdue proposals.

### Friday
- review:
  - new accounts/leads;
  - contact rate;
  - qualified leads;
  - demos;
  - proposals;
  - wins/losses;
  - source effectiveness;
  - overdue follow-ups;
  - lost reasons.

## 16. Launch KPI baseline

These are **operating hypotheses**, not promises. Recalibrate after the first 50–100 qualified accounts.

Weekly team activity baseline:
- 75–100 new researched target accounts;
- 50+ valid first-touch attempts;
- 15+ meaningful two-way conversations;
- 8+ qualified discovery calls;
- 5+ product demos;
- 3+ formal proposals.

Outcome metrics:
- lead-to-qualified rate;
- qualified-to-demo rate;
- demo-to-proposal rate;
- proposal-to-win rate;
- median days from NEW to WON;
- annual contract value won;
- pipeline value by stage;
- win/loss reason;
- conversion by source.

Do not game activity volume at the expense of target-account quality.

## 17. Initial market coverage

Start with a controlled geographic cluster for operational learning, then expand.

Suggested first motion:
1. Ghaziabad / Noida / Greater Noida / Delhi NCR independent schools.
2. Local coaching and training institutes.
3. Broader Uttar Pradesh/NCR through official school directories.
4. Referral-led institutions outside the region.
5. National outbound after scripts, implementation capacity and objections are stable.

## 18. Compliance and reputation guardrails

- Use legitimate institutional/business sources.
- Respect opt-outs and requests not to be contacted.
- Do not misrepresent affiliation, clients, certifications or government approval.
- Do not buy unverified personal-data lists.
- Do not mass-message students/parents to sell institutional SaaS.
- Keep sales notes professional and business-relevant.
- Use the current approved privacy/legal pack for inbound data handling.
- Escalate unusual procurement/privacy/security promises before accepting them.

## 19. Platform ownership

The dedicated **SaaS Sales** workspace is platform-only.

It is intentionally separate from:
- tenant Admissions CRM;
- learner/premium leads;
- customer institution enquiry data.

This prevents prospect data for the Being Brilliant SaaS business from mixing with a tenant's admissions records.

## 20. Step 10 exit criteria

Step 10 is complete when:
- inbound demo leads enter the dedicated SaaS pipeline;
- platform admin can add outbound target accounts;
- dashboard measures source/stage/follow-up/wins;
- activities and next actions are logged;
- won/lost closure is controlled;
- plan/value fields exist;
- official lead-source and ICP playbook exists;
- KPI cadence exists;
- CI protects the separation from tenant admissions CRM.
