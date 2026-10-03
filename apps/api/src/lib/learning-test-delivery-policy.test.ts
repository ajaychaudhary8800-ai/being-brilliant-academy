import assert from "node:assert/strict";
import test from "node:test";
import {
  learningTestAdapterReadiness,
  learningTestAttemptExpiry,
  learningTestAvailability,
  learningTestDeliveryPolicySchema,
  learningTestOfflineLease,
  learningTestResumeDecision,
  prepareLearningTestDelivery,
  resolveLearningTestDeliveryForStudent,
  resolveLearningTestDeliveryPolicy,
  stableSeededShuffle,
} from "./learning-test-delivery-policy.js";

test("unconfigured delivery policy preserves legacy unlimited behavior", () => {
  const resolved = resolveLearningTestDeliveryForStudent(null, "clteststudent000000000001");
  assert.equal(resolved.configured, false);
  assert.equal(resolved.maximumAttempts, null);
  assert.equal(resolved.policy.shuffleQuestions, false);
  assert.equal(resolved.policy.shuffleOptions, false);
});

test("student accommodation overrides attempt count, availability and duration", () => {
  const studentId = "clteststudent000000000001";
  const resolved = resolveLearningTestDeliveryForStudent({
    maxAttempts: 1,
    accommodations: [{
      studentId,
      extraTimeMinutes: 30,
      maxAttemptsOverride: 2,
      availableFrom: "2026-09-30T04:00:00.000Z",
      availableUntil: "2026-09-30T07:00:00.000Z",
      locale: "hi-IN",
      accessibility: { screenReaderOptimized: true, fontScale: 1.25 },
    }],
  }, studentId);

  assert.equal(resolved.maximumAttempts, 2);
  assert.equal(resolved.accommodation?.extraTimeMinutes, 30);
  assert.equal(resolved.accommodation?.accessibility.screenReaderOptimized, true);
  assert.equal(learningTestAvailability({
    accommodation: resolved.accommodation,
    now: new Date("2026-09-30T05:00:00.000Z"),
  }).open, true);
  assert.equal(learningTestAttemptExpiry({
    startedAt: new Date("2026-09-30T05:00:00.000Z"),
    durationMinutes: 60,
    accommodation: resolved.accommodation,
  }).toISOString(), "2026-09-30T06:30:00.000Z");
});

test("hard close caps accommodation time", () => {
  const policy = resolveLearningTestDeliveryForStudent({
    accommodations: [{ studentId: "clteststudent000000000001", extraTimeMinutes: 60 }],
  }, "clteststudent000000000001");
  assert.equal(learningTestAttemptExpiry({
    startedAt: new Date("2026-09-30T05:00:00.000Z"),
    durationMinutes: 60,
    accommodation: policy.accommodation,
    hardClosesAt: new Date("2026-09-30T06:15:00.000Z"),
  }).toISOString(), "2026-09-30T06:15:00.000Z");
});

test("seeded shuffle is deterministic and primitive option shuffling is marking-safe", () => {
  assert.deepEqual(stableSeededShuffle([1,2,3,4,5], "seed"), stableSeededShuffle([1,2,3,4,5], "seed"));

  const policy = learningTestDeliveryPolicySchema.parse({ shuffleQuestions: true, shuffleOptions: true });
  const source = [
    { questionId: "q1", question: { options: ["A", "B", "C", "D"] } },
    { questionId: "q2", question: { options: ["True", "False"] } },
  ];
  const first = prepareLearningTestDelivery({ questions: source, seed: "attempt-seed", policy });
  const second = prepareLearningTestDelivery({ questions: source, seed: "attempt-seed", policy });
  assert.deepEqual(first, second);
  assert.equal(first.optionShuffleSkippedQuestionIds.length, 0);
});

test("structured options fail safe and are not shuffled", () => {
  const policy = learningTestDeliveryPolicySchema.parse({ shuffleOptions: true });
  const source = [{ questionId: "q1", question: { options: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }] } }];
  const result = prepareLearningTestDelivery({ questions: source, seed: "seed", policy });
  assert.deepEqual(result.questions[0]?.question.options, source[0]?.question.options);
  assert.deepEqual(result.optionShuffleSkippedQuestionIds, ["q1"]);
});

test("configured resume policy enforces resume, client binding and offline lease", () => {
  const policy = learningTestDeliveryPolicySchema.parse({
    maxResumes: 2,
    bindClientInstance: true,
    offlineGraceSeconds: 300,
  });
  assert.equal(learningTestResumeDecision({
    configured: true,
    policy,
    resumeCount: 2,
    boundClientInstanceId: "device-a",
    requestedClientInstanceId: "device-a",
  }).reason, "MAX_RESUMES_REACHED");

  assert.equal(learningTestResumeDecision({
    configured: true,
    policy,
    resumeCount: 0,
    boundClientInstanceId: "device-a",
    requestedClientInstanceId: "device-b",
  }).reason, "CLIENT_INSTANCE_MISMATCH");

  assert.equal(learningTestResumeDecision({
    configured: true,
    policy,
    resumeCount: 0,
    boundClientInstanceId: "device-a",
    requestedClientInstanceId: "device-a",
    offlineLeaseUntil: new Date("2026-09-30T04:59:00.000Z"),
    now: new Date("2026-09-30T05:00:00.000Z"),
  }).reason, "OFFLINE_LEASE_EXPIRED");

  assert.equal(learningTestOfflineLease({
    now: new Date("2026-09-30T05:00:00.000Z"),
    policy,
  }).toISOString(), "2026-09-30T05:05:00.000Z");
});

test("required lockdown and proctoring integrations fail closed when provider is absent", () => {
  const policy = learningTestDeliveryPolicySchema.parse({
    lockdown: { required: true, providerKey: "safe-browser-v1" },
    proctoring: { required: true, providerKey: "proctor-x" },
  });
  assert.deepEqual(
    learningTestAdapterReadiness(policy, ["safe-browser-v1"]),
    { ready: false, blockers: ["PROCTORING_ADAPTER_UNAVAILABLE"] },
  );
  assert.equal(learningTestAdapterReadiness(policy, ["safe-browser-v1", "proctor-x"]).ready, true);
});

test("delivery policy rejects duplicate accommodations and missing required adapter providers", () => {
  assert.equal(learningTestDeliveryPolicySchema.safeParse({
    accommodations: [
      { studentId: "clteststudent000000000001" },
      { studentId: "clteststudent000000000001" },
    ],
  }).success, false);
  assert.equal(learningTestDeliveryPolicySchema.safeParse({
    lockdown: { required: true },
  }).success, false);
});

test("explicit policy parsing distinguishes configured from legacy state", () => {
  assert.equal(resolveLearningTestDeliveryPolicy(undefined).configured, false);
  assert.equal(resolveLearningTestDeliveryPolicy({ maxAttempts: 1 }).configured, true);
});
