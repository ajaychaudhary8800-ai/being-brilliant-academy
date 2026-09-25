# Service Level & Support Policy

## 1. Scope

This policy applies to paid production subscriptions. It does not apply to trials, sandbox/staging environments, scheduled implementation work, client devices/networks, or third-party systems outside Provider control.

## 2. Availability objective

The standard production **availability objective is 99.5% per calendar month**.

A contractual service-credit SLA applies only where the Order Form expressly states **"Service Credit SLA: Included"**. This avoids representing a service credit where the commercial order did not include one.

Availability excludes:
- announced maintenance;
- emergency security maintenance;
- Client-caused outages/configuration;
- internet/DNS/provider failure outside Provider's reasonable control;
- force majeure;
- suspension permitted by contract.

## 3. Service credits when expressly included

| Monthly availability | Credit against affected monthly subscription fee |
| --- | ---: |
| 99.0%–99.49% | 5% |
| 98.0%–98.99% | 10% |
| Below 98.0% | 15% |

Credits are capped at 15% of the affected monthly subscription fee and are the exclusive monetary remedy for availability failure unless mandatory law or the Order Form states otherwise. Client must request a credit within 30 days with reasonable incident details.

## 4. Incident priorities

**P1 Critical:** production unavailable for most authorized users, confirmed cross-tenant exposure, material security incident, or critical data-integrity failure with no practical workaround.

**P2 High:** major contracted workflow materially impaired for multiple users with no reasonable workaround.

**P3 Normal:** limited functional defect with workaround or non-critical module issue.

**P4 Request:** guidance, configuration request, cosmetic issue or enhancement request.

## 5. Standard response targets

Measured during published support hours unless the Order Form provides extended coverage.

| Priority | Initial response target |
| --- | --- |
| P1 | 2 business hours |
| P2 | 4 business hours |
| P3 | 1 business day |
| P4 | 2 business days |

Response means acknowledgement and triage, not guaranteed resolution. Resolution depends on severity, reproducibility, dependencies and safe release controls.

**Support hours:** [[INSERT APPROVED SUPPORT HOURS AND HOLIDAYS BEFORE EXTERNAL ISSUE]].

## 6. Planned maintenance

Provider will use reasonable efforts to schedule disruptive planned maintenance outside common institutional operating hours and provide advance notice where practicable. Emergency security fixes may occur without advance notice.

## 7. Backup and disaster recovery

Provider maintains backup procedures appropriate to the contracted deployment. **No off-site backup RPO/RTO or isolated disaster-recovery restoration commitment is made under this standard policy until such capability is expressly stated in the Order Form and technically verified.**

This clause must be reviewed after completion of the off-site DR workstream.

## 8. Security incidents

Security incidents are handled under the DPA and Security Schedule. Security reporting should use the designated security/support contact in the Order Form.

## 9. Client responsibilities

Client will provide sufficient information, timestamps, affected users, screenshots/logs where safe, and reasonable reproduction steps. Client must not transmit passwords or unnecessary sensitive data in support tickets.

## 10. Support boundaries

Standard support covers normal use of contracted features. Data correction, historical reconciliation, custom development, third-party vendor administration, complex migration and on-site work may be separately chargeable.
