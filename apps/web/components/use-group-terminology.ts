"use client";

import { useEffect, useState } from "react";
import { getAccessToken } from "./auth-provider";
import { institutionPresentation, type InstitutionPresentation } from "./institution-presentation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
export type GroupTerminology = InstitutionPresentation;
const fallback = institutionPresentation();
const cache = new Map<string, InstitutionPresentation>();
const pending = new Map<string, Promise<InstitutionPresentation>>();

export function groupTerminology(type?: string, custom?: string | null): GroupTerminology {
  return institutionPresentation(type, custom);
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
