# Service Level Agreement (SLA)

This SLA forms part of the SaaS Subscription Agreement for the Being Brilliant platform.

## 1. Scope

This SLA applies to the production SaaS service purchased under an active paid Order Form. It does not apply to trials, sandbox environments, staging, custom code awaiting acceptance, or third-party services outside Provider control unless expressly stated.

## 2. Availability target

**Monthly production availability target: 99.5%.**

Availability is calculated as:

`(Total minutes in month - Unavailable minutes) / Total minutes in month × 100`

Unavailable minutes are counted only where the production service is materially unavailable to the Client due to a Provider-controlled platform failure.

## 3. Exclusions

Availability calculations exclude:

- planned maintenance with reasonable prior notice;
- emergency security maintenance;
- Client network/device/DNS failures;
- Client configuration errors or unsupported use;
- third-party payment, messaging, DNS, cloud or connectivity provider outages outside Provider's reasonable control;
- force majeure;
- suspension permitted by the Agreement;
- beta/preview features;
- incidents caused by Client custom code/integrations not maintained by Provider.

## 4. Support channels

Primary: [support email / ticket portal]  
Escalation: [ ]  
Emergency security contact: [ ]

Standard support hours: **Monday–Saturday, 09:00–18:00 IST**, excluding declared public/company holidays, unless the Order Form includes enhanced support.

Enterprise clients may receive separately contracted extended support.

## 5. Incident priorities

| Priority | Definition | Initial Response Target |
| --- | --- | --- |
| P1 Critical | Production unavailable for most users, critical security event, or material data-integrity risk | 1 business hour |
| P2 High | Major workflow materially impaired with no reasonable workaround | 4 business hours |
| P3 Normal | Non-critical defect with workaround or limited user impact | 1 business day |
| P4 Request | How-to, configuration, enhancement or cosmetic issue | 2 business days |

Response target means acknowledgement/triage start, not guaranteed resolution time.

## 6. Incident management

Provider will use reasonable efforts to:

- acknowledge and classify incidents;
- investigate and mitigate;
- provide status updates appropriate to severity;
- restore service before completing root-cause remediation where safe;
- document material P1 incidents.

For a material P1 incident, Provider will provide a post-incident summary on reasonable request after stabilization.

## 7. Maintenance

Provider may perform maintenance necessary for reliability/security. Planned maintenance likely to cause material downtime should ordinarily be notified at least 24 hours in advance where reasonably practicable.

## 8. Backups and disaster recovery

Provider maintains production backup/recovery controls according to its current operations policy. Contractual RPO/RTO values, if required by Client, must be expressly stated in the Order Form or Enterprise schedule; they are not implied by this standard SLA.

## 9. Service credits

For standard plans, the primary remedy for availability failure is remediation and service restoration. Service credits apply only if expressly stated in the Order Form.

If an Enterprise Order Form includes credits, it must specify:

- availability threshold;
- credit percentage;
- maximum monthly credit;
- claim window;
- exclusions.

Credits never exceed the affected month's subscription fee and are not cash refunds unless expressly agreed.

## 10. Client obligations

Client must provide timely diagnostic information, maintain accurate administrator contacts and reasonably cooperate with incident resolution.

## 11. Security incidents

Security/privacy incident handling is governed by the DPA in addition to this SLA.
