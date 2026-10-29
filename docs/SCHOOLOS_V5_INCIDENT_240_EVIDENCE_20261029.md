# SchoolOS V5 staging — incident #240 evidence correlation (29 October 2026)

**Disposition: OPEN / ROOT CAUSE NOT DETERMINED / OPERATIONS RELEASE HOLD.**
This note uses actual GitHub Actions job logs and operator-supplied monitoring screenshots; it is not a server-log inspection, incident closure, or independent signoff. Times below are **UTC**, not IST. V5 host only: `v5-staging.beingbrilliantedu.com`. Do not confuse it with V4 production or `main-staging`.

## Reconstructed external observations

| UTC event | Independently fetched GitHub job evidence | Interpretation and limit |
| --- | --- | --- |
| **23 Oct 07:19:48–07:21:37** | [Run 39916966876, job 120292513647](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/39916966876): six real V5 GET probes failed after two attempts with `UND_ERR_CONNECT_TIMEOUT`; [browser job 120292513583](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/39916966876) had **4 passed** in the same workflow. | External Node/Undici transport failure. Browser success is from a separate runner/job, not proof both clients used the same network route. No origin 5xx or DNS failure reason is captured. |
| **23 Oct 07:45:50–07:50:39** | [Run 39919943377](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/39919943377): real GET checks `/login` and both API health paths returned **HTTP 200**; separate Chromium browser job 120302466140 had **4 failed** (including retries), each `page.goto` exceeding 20 s while waiting for `load`. | HTTP pass did **not** guarantee user-facing browser navigation. The timeout before the DOM and resource-completion distinction needs origin/edge/browser trace inspection. |
| **23 Oct 11:12:33–11:12:35** | [Run 39944051108, successful external smoke job 120383553489](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/39944051108): real public and health GETs **HTTP 200**, unauthorized requests **HTTP 401**. | Later successful run establishes recovery for that probe only; it cannot identify the earlier timeout's cause. This run had an earlier failed attempt recorded separately in issue #240. |
| **27 Oct ~10:17–10:19** | [Run 40486963071](https://github.com/ajaychaudhary8800-ai/being-brilliant-academy/actions/runs/40486963071), original browser job 122131055942: **4 failed** on `/login` and `/login/admin` with `page.goto` 20 s `domcontentloaded` timeouts (including retries); smoke/isolated DB/local browser jobs passed. | Recurrence despite prior switch to `domcontentloaded`; no basis to dismiss as a harmless `load`-event wait. |
| **27 Oct 10:21:29–10:21:38** | Same run, rerun job 122133667210: **4 passed in 11.3 s**; logged real HTTP 200, DOM-ready about **322–1,571 ms** across portal routes. | Strong evidence of intermittency between attempts, not of fix or known root cause. |

## New monitoring, 29 October

Operator screenshots show HetrixTools `SchoolOS V5 Readiness`: Website type, **Active/Online**, **Default Contact** assigned, **1-minute** cadence, **10-second** timeout, 100% during a newly created ~35-minute history. A VPS HTTPS probe recorded `HTTP_STATUS=200`, `SSL_VERIFY=0` (certificate verification succeeded), `RESPONSE_TIME=0.182195` seconds. The prior Hetrix setup received an owner-reported Telegram test message. Monitor-specific **DOWN and RECOVERY delivery** has not been demonstrated; the Coolify Telegram backup monitor is separate. A green **readiness** endpoint does not independently establish `/login` usability or Playwright DOM rendering. These new observations do not retrospectively disprove the October 23/27 incidents.

## Operational diagnosis and acceptance needed — no unsafe retries

1. **Origin path:** authorized operations reviewer to correlate the above UTC windows with available V5-only Nginx/Web/API restart and access/error logs, reverse-proxy 499/502/503/504 rates, and upstream connection failures; record if logs are expired/unavailable. Exclude URLs, tokens, cookies, student data, raw credentials from shared reports. Do **not** restart containers to collect this.
2. **External edge:** inspect relevant DNS A/AAAA resolution, TLS/connect timing and any Cloudflare edge/WAF/rate-limit events for the exact hostname and windows. Client-specific timeouts do not prove a particular DNS/IPv6 or origin cause.
3. **Detection coverage:** retain the independent 1-minute V5 readiness monitor with `Default Contact`; consider a separate `/login` HTTP monitor and periodic authenticated/synthetic browser navigation. Neither replaces an independently received **DOWN/RECOVERY** alert and documented on-call ownership. A synthetic contact-test must never interrupt the real service.
4. **Disposition:** keep issue #240 OPEN until the responsible operations reviewer records either evidenced root-cause/remediation or an explicit residual-risk decision with observation window, escalation recipient, triggers for recurrence, and review date. A successful rerun alone cannot close the incident.

**No V5/V4 server, payment, tenant, database, or production mutations were made for this investigation.** Release Gate 8 and overall commercial production remain **PENDING/HOLD**; do not manufacture reviewer acceptance.

## VPS historical-log retention and source classification — 29 October

Operator ran **read-only** commands on `root@srv1880999` for the same three UTC incident windows. The current seven V5 Compose containers were all created **28 October 2026**, after the events. Current Nginx uses Docker `json-file` logging and has no explicit persistent log mount, so its current container log cannot contain the original **23/27 October** event streams.

**Historical journal counts, source fields only** (no log MESSAGE content examined or printed):

| UTC window | Journal entries | Exact source metadata |
| --- | ---: | --- |
| 23 Oct 07:18–07:23 | 3 | `init.scope`: 3 |
| 23 Oct 07:45–07:51 | 9 | `cron.service`: 2; `CRON`: 1; `qemu-guest-agent.service`: 3; `init.scope`: 3 |
| 27 Oct 10:16–10:22 | 6 | `cron.service`: 3; `init.scope`: 3 |

**Conclusion of this specific forensic path:** None of the 18 retained journal entries is attributed through the inspected source metadata to Nginx, Docker, Web/API, or an obvious proxy/TLS event. These sources do not provide an attributable origin root-cause trail. Journal messages were intentionally **not** inspected; some entries could contain indirect evidence, so this finding is **insufficient evidence**, not proof the host was uninvolved. Existing logs from replaced containers remain unverified as externally archived; do not infer their preservation. No additional broad journal queries or healthy endpoint rechecks are warranted without a concrete new hypothesis.

**Incident #240 disposition:** `OPEN — INCONCLUSIVE HISTORICAL ORIGIN LOGS`. A responsible operations reviewer may obtain relevant historical Cloudflare/edge or central logging if actually retained, or issue a documented time-bounded **residual-risk decision** with reviewer identity, observation period, severity triggers, on-call/escalation coverage and explicit acceptance; do **not** automatically accept risk based on green readiness checks or auto-close this issue. Formal Gate 8 and production GO remain HOLD. No server, database, payment, volume or credential changes performed.
