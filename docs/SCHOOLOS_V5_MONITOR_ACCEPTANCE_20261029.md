# V5 monitor acceptance — HOLD

Candidate remains c8c80151b6f0919552d60c5cb71af1b92d319ff5. New support scripts do not imply application deployment.

## Prepared

Run `python3 scripts/schoolos_v5_monitor.py` on a trusted Linux monitor host. Exit 0 means all three observations passed; exit 1 means failure. Unit validation: `python3 -m unittest discover -s scripts -p test_schoolos_v5_monitor.py` (eight PASS locally). The probe uses no credentials, accepts only the fixed V5 origin/paths, refuses redirects, validates TLS and health JSON, applies an 8s limit and 25s process wall timeout. Errors omit response bodies and exception messages. No retry hides an initial failure.

## Observations, 29 Oct

Assistant egress: homepage/ready/operational HTTP 200 at 8.999/8.935/8.970s, policy FAIL. Follow-up curl readiness HTTP 200, total 5.956022s, TLS complete 5.624046s. This execution path may include a proxy. The observations do not prove origin failure or incident #240 root cause. VPS comparison subsequently supplied by operator; see below. Retain both failed and later healthy observations.

## Activation requirements

No schedule or notification is active from this PR. Existing candidate uptime workflow excludes V5 and GitHub draft-branch schedules do not run as default-branch schedules. Do not modify main merely to activate this probe.

Use an authorized off-host scheduler so VPS loss cannot suppress checks. Select an accountable monitor owner and exact alert destination with authorization to send test/failure/recovery notifications. Persist each state transition, notify on initial failure, deduplicate repeats with periodic escalation, and report recovery without closing unresolved root-cause issue #240. Preserve last-run/last-success timestamps and detect missed executions. Proposed interval: 5 minutes, subject to operations acceptance.

Verify alert routing using a separate synthetic failure test in the monitor platform, never by interrupting the real application or weakening TLS. Record received/acknowledged alert, actual recipient, UTC time, test reference and recovery notification. A healthy probe alone does not close monitoring readiness. Same-host probes are useful diagnostics but cannot independently prove external availability.

Outstanding: active off-host scheduler, authorized alert recipient and receipt, primary/backup ownership, #240 root-cause evidence or accountable residual-risk disposition. All formal gates remain HOLD.

## VPS comparison supplied by operator

29 October: Ajay supplied curl output from srv1880999. All three status/timing checks passed the 8s ceiling:

| Route | HTTP | TLS complete (s) | Total (s) |
| --- | --- | --- | --- |
| / | 200 | 0.250707 | 0.310903 |
| /api/health/ready | 200 | 0.025901 | 0.032904 |
| /api/health/operational | 200 | 0.022438 | 0.027172 |

This is operator-supplied status/timing evidence, not JSON dependency validation or independent off-host availability. It supports an execution-path-specific explanation for the earlier slow external samples, but does not isolate the cause or resolve historical #240. No more repetition of this successful comparison is required. Active off-host schedule, authorized alert destination, delivered failure/recovery notification and accountable support ownership remain pending. No alert sent or infrastructure configuration changed.

## Recovered Telegram monitoring history — 29 October reconciliation

Prior conversation retrieval establishes an owner confirmation on 21 October that the Telegram test notification was received and Coolify integration enabled. Prior assistant records identify Coolify Scheduled Task `SchoolOS-V5-Backup-Monitor`, running in the backup container on cron `15 4 * * *` (04:15 UTC / 09:45 IST daily), checking backup health/date/checksum/R2 listing. They also record successful Telegram delivery from an intentional scheduled-task failure and subsequent deletion of that temporary test task.

Evidence attribution: notification receipt is an earlier owner confirmation; task configuration and failure-test details are recovered conversation records, not a fresh independent inspection of Coolify. No bot token or chat ID was retrieved or disclosed. Reuse the existing Telegram channel; do not request a new email destination or repeat its successful historical test merely because it was missing from this packet.

This corrects the earlier broad statement that no notification setup/delivery evidence existed. Remaining: current task enabled state and latest execution outcome, whether V5 HTTP/worker failures are routed to that channel, and an off-host outage detector. A backup check hosted on the same VPS cannot alert reliably when the VPS itself is unreachable. Do not equate daily backup monitoring with continuous external uptime monitoring. No new notification was sent or provider setting changed.

## Current backup monitor state — operator verification, 29 October

Read-only Coolify query returned exactly one SchoolOS-V5-Backup-Monitor: task id 1, enabled true, frequency 15 4 * * *, container backup, application_id 14, service_id null. Latest execution id 10 succeeded from 2026-10-29 04:15:07 to 04:15:10 UTC (09:45:07–09:45:10 IST). Telegram settings present and telegram_enabled true. No changes or credentials printed. Raw task command and logs were intentionally not retrieved.

Together with the earlier owner-confirmed Telegram delivery, this closes the missing current backup-task enabled/latest-success evidence. It is not a new Telegram delivery test, does not verify every event-specific notification flag or link application_id 14 independently to the V5 UUID, and does not prove off-host HTTP uptime detection. Do not repeat backup monitor setup or successful execution. Remaining monitoring work is specifically external availability/worker coverage and failure routing, not whether a Telegram channel exists.

## External uptime monitor activated — owner screenshot and VPS check, 29 October 2026

Owner supplied a HetrixTools **SchoolOS V5 Readiness (Recent History)** screenshot. The panel reports **Online**, monitored since 29 October 2026, current uptime **100% since monitoring began** (Online for 22 minutes at screenshot time), recent average load **446.07 ms**, check frequency **1 minute**, timeout **10 seconds**, with checks visible from New York and Singapore. The screenshot shows last overall check one minute earlier. The 24-hour, seven-day and 30-day 100% percentages do **not** establish coverage over those periods because the monitor had only recently been created. This is owner-supplied configuration/availability evidence, not an independent authenticated platform inspection or a synthetic outage test.

From `root@srv1880999`, owner also supplied an HTTPS readiness probe:

```text
HTTP_STATUS=200
SSL_VERIFY=0
RESPONSE_TIME=0.182195
```

The successful VPS probe and external monitor's green status reconcile the earlier UI report of `DOWN` as **no longer current**. They do not prove the cause of that earlier transient state or close historical incident #240. `SSL_VERIFY=0` is the successful libcurl certificate verification result; it does not mean SSL verification was turned off. No application restart or deployment was required.

**New monitoring state:** off-host 1-minute website monitor targeting V5 readiness is operator-evidenced active, with present uptime detection. **Contact notification evidence:** During the preceding HetrixTools/contact-list setup, the owner reported saving a Telegram Chat ID and subsequently receiving a message. This is operator-reported delivery of a Telegram setup/test message in the HetrixTools configuration sequence, not independently observed sender identity, proof of the monitor's selected contact list, or a real downtime/recovery event. The Coolify backup Telegram configuration is a separate route; do not conflate them. **Still unverified:** precise selected contact list and alert recipient for this monitor, delivered **HetrixTools failure and recovery** event routing, worker-specific alerting, primary/backup response owner and escalation, and independent #240 disposition. Where supported, verify a non-disruptive test from the configured contact list without taking down the real service. Preserve all formal release gates PENDING and production HOLD until signed reviews.
