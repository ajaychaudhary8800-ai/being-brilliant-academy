# Internal Legal Research Notes — India SaaS Contract Pack

**Research date:** 25 September 2026  
**Purpose:** internal drafting control only; not a client-facing legal opinion.

## 1. Contract framework

The Indian Contract Act, 1872 remains the core general contract statute. The Master Agreement therefore uses conventional offer/acceptance, consideration, authority, breach, limitation and notice structures rather than relying on clickwrap language alone for negotiated institutional customers.

## 2. Arbitration

The dispute clause is structured under the Arbitration and Conciliation Act, 1996, with:
- Indian law;
- good-faith executive escalation first;
- one jointly appointed arbitrator;
- New Delhi as seat;
- English proceedings.

Counsel should confirm the preferred court/seat strategy before first signature.

## 3. DPDP Act / Rules status as of the research date

The Digital Personal Data Protection Act, 2023 is subject to phased commencement under the Central Government notification published in November 2025.

The notification schedules:
- specified institutional/Board/administrative provisions from publication;
- section 6(9) and section 27(1)(d) one year after publication;
- many core processing, consent, Data Fiduciary obligations, rights, children, significant-data-fiduciary and enforcement provisions eighteen months after publication.

The Digital Personal Data Protection Rules, 2025 are also phased:
- Rules 1, 2 and 17–21 from publication;
- Rule 4 one year after publication;
- Rules 3, 5–16, 22 and 23 eighteen months after publication.

Accordingly, customer documents should be **DPDP-ready** but should not say every substantive obligation is already legally in force on 25 September 2026.

## 4. School/student data allocation

For institution-controlled student, parent and employee records, the contract is drafted on the operational assumption that the institution ordinarily determines the purpose and essential means and Provider processes on documented instructions.

This allocation can vary by workflow. Provider may independently determine purposes for its own:
- business contacts;
- subscription/billing administration;
- fraud/security logging;
- contractual administration;
- legal compliance.

The DPA therefore avoids saying Provider is always only a processor.

## 5. Child data

The DPDP Act contains specific child-data provisions, including verifiable parental/guardian consent and restrictions on certain tracking/behavioural advertising, subject to commencement and applicable exemptions. The contract places institution-controlled consent/notice responsibility with Client and prohibits independent targeted advertising/profiling by Provider using Client child data.

## 6. Security and incident drafting

The pack promises only controls evidenced by current architecture. It intentionally avoids unverified claims such as:
- ISO 27001 certification;
- SOC 2 certification;
- PCI DSS certification by Provider;
- India-only residency;
- a tested off-site DR RPO/RTO.

The DPA uses a contractual target to notify Client within 24 hours after Provider confirms a Client-data security incident. This is an internal customer-notification target, not a statement of the statutory regulator-notification deadline.

## 7. Step 5 status

The production Cloudflare R2 backup path and an isolated PostgreSQL + file-storage restore drill were evidenced on 6 October 2026.

That evidence supports the technical launch-readiness gate, but it does not by itself justify:
- a fixed contractual RPO/RTO;
- guaranteed cross-region restoration;
- DR service credits; or
- broader recovery commitments not supported by the contracted architecture.

## 8. Execution particulars status

Company management supplied provider particulars on 6 October 2026 and subsequently directed that the MCA-covered particulars in the official MCA Company Information extract dated 23 October 2024 be used in the controlled legal pack. Those adopted particulars are recorded in `EXECUTION_PARTICULARS.md`.

Before the first external signature/public privacy publication:
- retain the official GST REG-06 verification evidence confirming GSTIN 09AAPCA1080N2Z7 and the registered principal place of business;
- keep the designated legal, privacy and support role mailboxes operational; inbound delivery has been verified and the support mailbox has passed SPF, DKIM and DMARC authentication;
- keep the confirmed business support phone, published support hours and designated role mailboxes operational;
- keep bank/payment destination details out of source control and insert them only from approved finance records; and
- obtain Indian counsel review of the controlled pack.

Personal email addresses and personal privacy/grievance phone details are intentionally excluded from the public repository.
