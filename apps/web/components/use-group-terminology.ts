"use client";

import { useEffect, useState } from "react";
import { getAccessToken } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
export type GroupTerminology = { singular: string; plural: string; course: string; select: string; add: string };
const fallback: GroupTerminology = { singular: "Batch", plural: "Batches", course: "Course", select: "Select Batch", add: "Add Batch" };
const cache = new Map<string, GroupTerminology>();
const pending = new Map<string, Promise<GroupTerminology>>();

export function groupTerminology(type?: string, custom?: string | null): GroupTerminology {
  const singular = type === "SECTION" ? "Section" : type === "GROUP" ? "Group" : type === "CUSTOM" && custom?.trim() ? custom.trim() : "Batch";
  return { singular, plural: singular.endsWith("s") ? singular : `${singular}s`, course: type === "SECTION" ? "Class" : "Course", select: `Select ${singular}`, add: `Add ${singular}` };
}

export function useGroupTerminology() {
  const [labels, setLabels] = useState<GroupTerminology>(fallback);
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const cached = cache.get(token); if (cached) { setLabels(cached); return; }
    let request = pending.get(token);
    if (!request) {
      request = fetch(`${API}/organization/settings`, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.ok ? response.json() : null).then(json => json?.data ? groupTerminology(json.data.groupLabelType, json.data.customGroupLabel) : fallback).catch(() => fallback).finally(() => pending.delete(token));
      pending.set(token, request);
    }
    void request.then(value => { cache.set(token, value); setLabels(value); });
  }, []);
  return labels;
}
