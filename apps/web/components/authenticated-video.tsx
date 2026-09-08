"use client";

import { useEffect, useState } from "react";
import { getAccessToken } from "./auth-provider";

export function AuthenticatedVideo({ url, className }: { url: string; className?: string }) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState("");

  useEffect(() => {
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setSource(undefined);
    setError("");
    void fetch(url, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Video is not available");
      objectUrl = URL.createObjectURL(await response.blob());
      setSource(objectUrl);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Video is not available");
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (error) return <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!source) return <p className="mt-4 text-sm text-slate-500">Loading video…</p>;
  return <video controls className={className} src={source} />;
}
