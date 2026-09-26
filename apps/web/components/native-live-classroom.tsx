"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, CameraOff, Circle, Download, Eraser, Hand, Lock, LogOut, MessageSquare,
  Mic, MicOff, MonitorUp, PenLine, Radio, RotateCcw, Save, ShieldCheck, Square,
  Unlock, UserMinus, Users, Wifi,
} from "lucide-react";
import { errorMessage, getAccessToken, useAuth } from "./auth-provider";
import { openAuthenticatedDocument } from "./authenticated-download";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const LIVEKIT_SCRIPT = "https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.umd.min.js";

type SessionData = {
  serverUrl: string;
  participantToken: string;
  liveClass: {
    id: string;
    title: string;
    description?: string | null;
    startsAt: string;
    endsAt: string;
    recordingStatus?: string | null;
  };
  role: string;
  manager: boolean;
  locked: boolean;
  recordingConfigured: boolean;
  recordingAvailable: boolean;
  whiteboardData: BoardItem[];
};
type Stroke = {
  surface: "whiteboard" | "annotation";
  x1: number; y1: number; x2: number; y2: number;
  color: string; width: number; mode: "pen" | "erase";
  strokeId?: string;
};
type BoardShape = {
  surface: "whiteboard";
  kind: "shape";
  itemId: string;
  shape: "rectangle" | "circle" | "arrow";
  x1: number; y1: number; x2: number; y2: number;
  color: string; width: number;
};
type BoardText = {
  surface: "whiteboard";
  kind: "text" | "note";
  itemId: string;
  x: number; y: number; w: number; h: number;
  text: string; color: string;
};
type BoardItem = Stroke | BoardShape | BoardText;
type Chat = { id: string; name: string; text: string; at: number; self?: boolean };
type ParticipantRow = { identity: string; name: string; micTrackSid?: string; hand?: boolean };
type ReactionBubble = { id: string; emoji: string; name: string };
type PollState = {
  id: string;
  question: string;
  options: Array<{ id: string; label: string; votes: number }>;
  open: boolean;
  voters: Record<string, string>;
};

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAccessToken() ?? ""}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.error?.message ?? "Request failed");
  return value;
}

async function loadLiveKit() {
  if (typeof window === "undefined") return null;
  const existing = (window as any).LivekitClient;
  if (existing) return existing;

  const prior = document.querySelector<HTMLScriptElement>(`script[src="${LIVEKIT_SCRIPT}"]`);
  if (prior && prior.dataset.livekitLoaded !== "true") prior.remove();

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error("Live classroom engine did not load within 15 seconds. Check network access and retry."));
    }, 15_000);
    script.src = LIVEKIT_SCRIPT;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      window.clearTimeout(timeout);
      script.dataset.livekitLoaded = "true";
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("Unable to load the LiveKit classroom engine. Please retry."));
    };
    document.head.appendChild(script);
  });

  const client = (window as any).LivekitClient;
  if (!client) throw new Error("Live classroom engine loaded but did not initialize.");
  return client;
}

export function NativeLiveClassroom({ roomName }: { roomName: string }) {
  const { user } = useAuth();
  const [session, setSession] = useState<SessionData | null>(null);
  const [room, setRoom] = useState<any>(null);
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [quality, setQuality] = useState("unknown");
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [chat, setChat] = useState<Chat[]>([]);
  const [chatText, setChatText] = useState("");
  const [handRaised, setHandRaised] = useState(false);
  const [hands, setHands] = useState<Record<string, boolean>>({});
  const [panel, setPanel] = useState<"class" | "whiteboard">("class");
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annotationDrawingMode, setAnnotationDrawingMode] = useState<"pen" | "erase">("pen");
  const [annotationColor, setAnnotationColor] = useState("#ef4444");
  const [studentDrawAllowed, setStudentDrawAllowed] = useState(false);
  const [drawingMode, setDrawingMode] = useState<"pen" | "erase">("pen");
  const [penColor, setPenColor] = useState("#0f172a");
  const [reactions, setReactions] = useState<ReactionBubble[]>([]);
  const [poll, setPoll] = useState<PollState | null>(null);
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [timerNow, setTimerNow] = useState(Date.now());
  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [deviceCheck, setDeviceCheck] = useState<"idle" | "testing" | "ok" | "failed">("idle");

  const mediaRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const whiteboardRef = useRef<HTMLCanvasElement>(null);
  const annotationRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<BoardItem[]>([]);
  const redoRef = useRef<BoardItem[][]>([]);
  const drawingRef = useRef<{ surface: Stroke["surface"]; x: number; y: number; strokeId: string } | null>(null);

  const manager = Boolean(session?.manager);
  const observer = session?.role === "PARENT";
  const canDraw = !observer && (manager || studentDrawAllowed);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/learning/live-classes/native/${encodeURIComponent(roomName)}/session`, { method: "POST", body: "{}" })
      .then(result => {
        if (cancelled) return;
        setSession(result.data);
        setLocked(Boolean(result.data.locked));
        strokesRef.current = Array.isArray(result.data.whiteboardData)
          ? (result.data.whiteboardData as BoardItem[]).map((item, index) => {
              if ("kind" in item) return { ...item, itemId: item.itemId || `legacy-item-${index}` };
              return { ...item, strokeId: item.strokeId || `legacy-stroke-${index}` };
            })
          : [];
      })
      .catch(cause => !cancelled && setError(errorMessage(cause)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [roomName]);

  const resizeCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const width = Math.max(1, Math.floor(canvas.clientWidth));
    const height = Math.max(1, Math.floor(canvas.clientHeight));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }, []);

  const drawStroke = useCallback((item: BoardItem) => {
    const canvas = item.surface === "whiteboard" ? whiteboardRef.current : annotationRef.current;
    if (!canvas) return;
    resizeCanvas(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();

    if ("kind" in item && item.kind === "shape") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = item.color;
      ctx.lineWidth = item.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const x1 = item.x1 * canvas.width, y1 = item.y1 * canvas.height;
      const x2 = item.x2 * canvas.width, y2 = item.y2 * canvas.height;
      const width = x2 - x1, height = y2 - y1;
      ctx.beginPath();
      if (item.shape === "rectangle") ctx.rect(x1, y1, width, height);
      if (item.shape === "circle") ctx.ellipse(x1 + width / 2, y1 + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
      if (item.shape === "arrow") {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = 14;
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    if ("kind" in item && (item.kind === "text" || item.kind === "note")) {
      const x = item.x * canvas.width, y = item.y * canvas.height;
      const w = item.w * canvas.width, h = item.h * canvas.height;
      if (item.kind === "note") {
        ctx.fillStyle = "#fef3c7";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      }
      ctx.fillStyle = item.color;
      ctx.font = `${item.kind === "note" ? 18 : 24}px sans-serif`;
      ctx.textBaseline = "top";
      const maxWidth = Math.max(60, w - 16);
      const words = item.text.split(/\s+/);
      let line = "", lineY = y + (item.kind === "note" ? 10 : 0);
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, x + (item.kind === "note" ? 8 : 0), lineY);
          line = word;
          lineY += item.kind === "note" ? 22 : 28;
        } else line = test;
      }
      if (line) ctx.fillText(line, x + (item.kind === "note" ? 8 : 0), lineY);
      ctx.restore();
      return;
    }

    const stroke = item as Stroke;
    ctx.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(stroke.x1 * canvas.width, stroke.y1 * canvas.height);
    ctx.lineTo(stroke.x2 * canvas.width, stroke.y2 * canvas.height);
    ctx.stroke();
    ctx.restore();
  }, [resizeCanvas]);

  const redraw = useCallback((surface: Stroke["surface"]) => {
    const canvas = surface === "whiteboard" ? whiteboardRef.current : annotationRef.current;
    if (!canvas) return;
    resizeCanvas(canvas);
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.filter(item => item.surface === surface).forEach(drawStroke);
  }, [drawStroke, resizeCanvas]);

  useEffect(() => {
    const onResize = () => { redraw("whiteboard"); redraw("annotation"); };
    window.addEventListener("resize", onResize);
    const timer = window.setTimeout(onResize, 100);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", onResize); };
  }, [redraw, panel, annotationMode]);

  const publish = useCallback(async (payload: any, reliable = true) => {
    if (!room) return;
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    await room.localParticipant.publishData(bytes, { reliable });
  }, [room]);

  const refreshParticipants = useCallback((activeRoom: any) => {
    if (!activeRoom) return;
    const rows: ParticipantRow[] = [];
    const all = [activeRoom.localParticipant, ...Array.from(activeRoom.remoteParticipants?.values?.() ?? [])] as any[];
    for (const participant of all) {
      const audioPubs = Array.from(participant.audioTrackPublications?.values?.() ?? participant.trackPublications?.values?.() ?? []) as any[];
      const mic = audioPubs.find(pub => String(pub.source ?? "").toLowerCase().includes("microphone") || String(pub.kind ?? "").toLowerCase().includes("audio"));
      rows.push({
        identity: participant.identity,
        name: participant.name || (participant.identity === activeRoom.localParticipant.identity ? user?.name ?? "You" : "Participant"),
        micTrackSid: mic?.trackSid ?? mic?.sid,
        hand: Boolean(hands[participant.identity]),
      });
    }
    setParticipants(rows);
  }, [hands, user?.name]);

  const rebuildMedia = useCallback((activeRoom: any) => {
    const target = mediaRef.current;
    if (!target || !activeRoom) return;
    target.innerHTML = "";
    const lk = (window as any).LivekitClient;
    const all = [activeRoom.localParticipant, ...Array.from(activeRoom.remoteParticipants?.values?.() ?? [])] as any[];
    for (const participant of all) {
      const publications = Array.from(participant.trackPublications?.values?.() ?? []) as any[];
      const videos = publications.filter(pub => pub.track && String(pub.kind ?? pub.track?.kind ?? "").toLowerCase().includes("video"));
      if (!videos.length) {
        const card = document.createElement("div");
        card.className = "grid min-h-44 place-items-center rounded-2xl bg-slate-900 p-4 text-center text-white";
        card.textContent = participant.name || "Participant";
        target.appendChild(card);
        continue;
      }
      for (const publication of videos) {
        const wrap = document.createElement("div");
        const shared = publication.source === lk?.Track?.Source?.ScreenShare || String(publication.source ?? "").toLowerCase().includes("screen");
        wrap.className = shared ? "relative col-span-full overflow-hidden rounded-2xl bg-black" : "relative overflow-hidden rounded-2xl bg-black";
        const element = publication.track.attach();
        element.className = "h-full max-h-[68vh] w-full object-contain";
        element.setAttribute("playsinline", "true");
        wrap.appendChild(element);
        const label = document.createElement("span");
        label.className = "absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white";
        label.textContent = `${participant.name || "Participant"}${shared ? " · Screen" : ""}`;
        wrap.appendChild(label);
        target.appendChild(wrap);
      }
    }
    refreshParticipants(activeRoom);
  }, [refreshParticipants]);

  const handleData = useCallback((payload: Uint8Array, participant: any) => {
    try {
      const message = JSON.parse(new TextDecoder().decode(payload));
      if (message.type === "chat") setChat(current => [...current, { id: crypto.randomUUID(), name: message.name ?? participant?.name ?? "Participant", text: String(message.text ?? ""), at: Number(message.at ?? Date.now()) }].slice(-200));
      if (message.type === "raise-hand") setHands(current => ({ ...current, [participant?.identity ?? message.identity]: Boolean(message.raised) }));
      if (message.type === "whiteboard" && message.stroke) {
        const item = message.stroke as BoardItem;
        strokesRef.current.push(item);
        drawStroke(item);
      }
      if (message.type === "whiteboard-undo") {
        const strokeId = message.strokeId ? String(message.strokeId) : "";
        const itemId = message.itemId ? String(message.itemId) : "";
        strokesRef.current = strokesRef.current.filter(item => {
          if (item.surface !== "whiteboard") return true;
          if ("kind" in item) return !itemId || item.itemId !== itemId;
          return !strokeId || item.strokeId !== strokeId;
        });
        redraw("whiteboard");
      }
      if (message.type === "clear-surface") {
        strokesRef.current = strokesRef.current.filter(item => item.surface !== message.surface);
        redraw(message.surface);
      }
      if (message.type === "reaction") {
        const reaction = { id: crypto.randomUUID(), emoji: String(message.emoji ?? "👍"), name: String(message.name ?? participant?.name ?? "Participant") };
        setReactions(current => [...current.slice(-5), reaction]);
        window.setTimeout(() => setReactions(current => current.filter(item => item.id !== reaction.id)), 3500);
      }
      if (message.type === "poll-start" && message.poll) setPoll(message.poll as PollState);
      if (message.type === "poll-vote" && message.pollId && message.optionId) {
        const voter = String(message.voter ?? participant?.identity ?? "");
        setPoll(current => {
          if (!current || current.id !== message.pollId || !current.open || !voter || current.voters[voter]) return current;
          return {
            ...current,
            voters: { ...current.voters, [voter]: String(message.optionId) },
            options: current.options.map(option => option.id === message.optionId ? { ...option, votes: option.votes + 1 } : option),
          };
        });
      }
      if (message.type === "poll-end") setPoll(current => current && current.id === message.pollId ? { ...current, open: false } : current);
      if (message.type === "timer-start") setTimerEndsAt(Number(message.endsAt) || null);
      if (message.type === "timer-stop") setTimerEndsAt(null);
      if (message.type === "whiteboard-permission") setStudentDrawAllowed(Boolean(message.allowed));
      if (message.type === "teacher-notice") setNotice(String(message.text ?? ""));
    } catch {
      // Ignore malformed classroom data packets.
    }
  }, [drawStroke, redraw]);

  useEffect(() => {
    if (room) refreshParticipants(room);
  }, [hands, room, refreshParticipants]);

  useEffect(() => {
    if (!timerEndsAt) return;
    const tick = () => {
      setTimerNow(Date.now());
      if (Date.now() >= timerEndsAt) setTimerEndsAt(null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [timerEndsAt]);

  async function testDevices() {
    setDeviceCheck("testing");
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach(track => track.stop());
      setDeviceCheck("ok");
    } catch (cause) {
      setDeviceCheck("failed");
      setError(cause instanceof Error ? cause.message : "Camera/microphone test failed");
    }
  }

  async function joinClass() {
    if (!session || joined) return;
    setJoining(true);
    setError("");
    try {
      const lk = await loadLiveKit();
      if (!lk) throw new Error("Live classroom engine is unavailable");
      const activeRoom = new lk.Room({ adaptiveStream: true, dynacast: true });
      activeRoom
        .on(lk.RoomEvent.TrackSubscribed, (track: any) => {
          if (String(track.kind).toLowerCase().includes("audio")) {
            const audio = track.attach();
            audioRef.current?.appendChild(audio);
          }
          window.setTimeout(() => rebuildMedia(activeRoom), 0);
        })
        .on(lk.RoomEvent.TrackUnsubscribed, (track: any) => {
          track.detach();
          window.setTimeout(() => rebuildMedia(activeRoom), 0);
        })
        .on(lk.RoomEvent.ParticipantConnected, () => window.setTimeout(() => rebuildMedia(activeRoom), 0))
        .on(lk.RoomEvent.ParticipantDisconnected, () => window.setTimeout(() => rebuildMedia(activeRoom), 0))
        .on(lk.RoomEvent.LocalTrackPublished, () => window.setTimeout(() => rebuildMedia(activeRoom), 0))
        .on(lk.RoomEvent.LocalTrackUnpublished, () => window.setTimeout(() => rebuildMedia(activeRoom), 0))
        .on(lk.RoomEvent.DataReceived, handleData)
        .on(lk.RoomEvent.ConnectionQualityChanged, (value: any, participant: any) => {
          if (!participant || participant === activeRoom.localParticipant) setQuality(String(value ?? "unknown"));
        })
        .on(lk.RoomEvent.Disconnected, () => {
          setJoined(false);
          setMicOn(false);
          setCameraOn(false);
          setScreenOn(false);
        });
      await Promise.race([
        activeRoom.connect(session.serverUrl, session.participantToken),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("Live classroom connection timed out. Please retry or check your network.")), 20_000)),
      ]);
      setRoom(activeRoom);
      setJoined(true);
      await api(`/learning/live-classes/${session.liveClass.id}/join`, { method: "POST", body: "{}" });
      window.setTimeout(() => {
        rebuildMedia(activeRoom);
        redraw("whiteboard");
      }, 50);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setJoining(false);
    }
  }

  async function leaveClass() {
    try {
      if (session) await api(`/learning/live-classes/${session.liveClass.id}/leave`, { method: "POST", body: "{}" });
    } catch {
      // Best effort attendance close.
    }
    room?.disconnect?.();
    setRoom(null);
    setJoined(false);
  }

  useEffect(() => () => { room?.disconnect?.(); }, [room]);

  useEffect(() => {
    if (!joined || !session) return;
    const closeAttendance = () => {
      void fetch(`${API}/learning/live-classes/${session.liveClass.id}/leave`, {
        method: "POST",
        keepalive: true,
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}`, "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", closeAttendance);
    return () => window.removeEventListener("pagehide", closeAttendance);
  }, [joined, session]);

  async function toggleMic() {
    if (!room) return;
    try {
      const next = !micOn;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      rebuildMedia(room);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function toggleCamera() {
    if (!room) return;
    try {
      const next = !cameraOn;
      await room.localParticipant.setCameraEnabled(next);
      setCameraOn(next);
      rebuildMedia(room);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function toggleScreen() {
    if (!room) return;
    try {
      const next = !screenOn;
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenOn(next);
      rebuildMedia(room);
    } catch (cause) {
      setError(manager ? errorMessage(cause) : "Teacher permission is required before a student can share the screen.");
    }
  }

  async function sendChat() {
    const text = chatText.trim();
    if (!text || !room) return;
    const message = { type: "chat", text, name: user?.name ?? "You", at: Date.now() };
    await publish(message, true);
    setChat(current => [...current, { id: crypto.randomUUID(), name: user?.name ?? "You", text, at: message.at, self: true }].slice(-200));
    setChatText("");
    if (session) void api(`/learning/live-classes/${session.liveClass.id}/interactions`, { method: "POST", body: JSON.stringify({ type: "CHAT", content: { text } }) }).catch(() => undefined);
  }

  async function toggleHand() {
    const raised = !handRaised;
    setHandRaised(raised);
    setHands(current => ({ ...current, [user?.id ?? "local"]: raised }));
    await publish({ type: "raise-hand", raised, identity: user?.id, name: user?.name }, true);
    if (session) void api(`/learning/live-classes/${session.liveClass.id}/interactions`, { method: "POST", body: JSON.stringify({ type: "RAISE_HAND", content: { raised } }) }).catch(() => undefined);
  }

  function pointerPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }
  function startDraw(surface: Stroke["surface"], event: React.PointerEvent<HTMLCanvasElement>) {
    if (!canDraw || !joined) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = pointerPoint(event);
    drawingRef.current = { surface, ...p, strokeId: crypto.randomUUID() };
  }
  async function moveDraw(surface: Stroke["surface"], event: React.PointerEvent<HTMLCanvasElement>) {
    const prev = drawingRef.current;
    if (!prev || prev.surface !== surface || !canDraw || !joined) return;
    const p = pointerPoint(event);
    const mode = surface === "annotation" ? annotationDrawingMode : drawingMode;
    const color = surface === "annotation" ? annotationColor : penColor;
    const stroke: Stroke = { surface, x1: prev.x, y1: prev.y, x2: p.x, y2: p.y, color, width: mode === "erase" ? 22 : surface === "annotation" ? 5 : 3, mode, strokeId: prev.strokeId };
    drawingRef.current = { surface, ...p, strokeId: prev.strokeId };
    strokesRef.current.push(stroke);
    drawStroke(stroke);
    await publish({ type: "whiteboard", stroke }, false);
  }
  function endDraw() { drawingRef.current = null; }

  async function addWhiteboardItem(item: BoardItem) {
    if (!canDraw || !joined) return;
    strokesRef.current.push(item);
    redoRef.current = [];
    drawStroke(item);
    await publish({ type: "whiteboard", stroke: item }, true);
  }

  async function insertWhiteboardText(kind: "text" | "note") {
    const label = kind === "note" ? "Sticky note text" : "Text to place on the whiteboard";
    const text = window.prompt(label)?.trim();
    if (!text) return;
    const existing = strokesRef.current.filter(item => item.surface === "whiteboard").length;
    const offset = Math.min(0.18, (existing % 6) * 0.025);
    await addWhiteboardItem({
      surface: "whiteboard",
      kind,
      itemId: crypto.randomUUID(),
      x: 0.12 + offset,
      y: 0.18 + offset,
      w: kind === "note" ? 0.28 : 0.5,
      h: kind === "note" ? 0.2 : 0.14,
      text: text.slice(0, 500),
      color: kind === "note" ? "#111827" : penColor,
    });
  }

  async function insertWhiteboardShape(shape: BoardShape["shape"]) {
    const positions = {
      rectangle: { x1: 0.25, y1: 0.25, x2: 0.62, y2: 0.52 },
      circle: { x1: 0.32, y1: 0.24, x2: 0.58, y2: 0.52 },
      arrow: { x1: 0.24, y1: 0.5, x2: 0.68, y2: 0.3 },
    } as const;
    await addWhiteboardItem({ surface: "whiteboard", kind: "shape", itemId: crypto.randomUUID(), shape, ...positions[shape], color: penColor, width: 4 });
  }

  async function undoWhiteboard() {
    if (!manager) return;
    for (let index = strokesRef.current.length - 1; index >= 0; index -= 1) {
      if (strokesRef.current[index].surface !== "whiteboard") continue;
      const [removed] = strokesRef.current.splice(index, 1);
      const group = [removed];
      if (!("kind" in removed) && removed.strokeId) {
        for (let prior = index - 1; prior >= 0; prior -= 1) {
          const candidate = strokesRef.current[prior];
          if ("kind" in candidate || candidate.surface !== "whiteboard" || candidate.strokeId !== removed.strokeId) break;
          group.unshift(...strokesRef.current.splice(prior, 1));
        }
      }
      redoRef.current.push(group);
      redraw("whiteboard");
      if ("kind" in removed) await publish({ type: "whiteboard-undo", itemId: removed.itemId }, true);
      else await publish({ type: "whiteboard-undo", strokeId: removed.strokeId }, true);
      return;
    }
  }

  async function redoWhiteboard() {
    if (!manager) return;
    const group = redoRef.current.pop();
    if (!group?.length) return;
    strokesRef.current.push(...group);
    redraw("whiteboard");
    for (const item of group) await publish({ type: "whiteboard", stroke: item }, true);
  }

  async function clearSurface(surface: Stroke["surface"]) {
    if (!manager) return;
    strokesRef.current = strokesRef.current.filter(item => item.surface !== surface);
    if (surface === "whiteboard") redoRef.current = [];
    redraw(surface);
    await publish({ type: "clear-surface", surface }, true);
  }

  async function saveWhiteboard() {
    if (!manager) return;
    try {
      await api(`/learning/live-classes/native/${encodeURIComponent(roomName)}/whiteboard`, { method: "PUT", body: JSON.stringify({ strokes: strokesRef.current.filter(stroke => stroke.surface === "whiteboard") }) });
      setNotice("Whiteboard saved to this class.");
    } catch (cause) { setError(errorMessage(cause)); }
  }

  function downloadWhiteboard() {
    const canvas = whiteboardRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "class-whiteboard.png";
    link.click();
  }

  async function classroomControl(action: string, identity?: string, trackSid?: string) {
    try {
      const result = await api(`/learning/live-classes/native/${encodeURIComponent(roomName)}/control`, { method: "POST", body: JSON.stringify({ action, identity, trackSid }) });
      if (action === "LOCK" || action === "UNLOCK") setLocked(Boolean(result.data.locked));
      setNotice(action.replaceAll("_", " ").toLowerCase());
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function toggleStudentDrawing() {
    const allowed = !studentDrawAllowed;
    setStudentDrawAllowed(allowed);
    await publish({ type: "whiteboard-permission", allowed }, true);
    setNotice(allowed ? "Students can now use the whiteboard." : "Student whiteboard drawing disabled.");
  }

  async function sendReaction(emoji: string) {
    if (!room || observer) return;
    const reaction = { id: crypto.randomUUID(), emoji, name: user?.name ?? "You" };
    setReactions(current => [...current.slice(-5), reaction]);
    window.setTimeout(() => setReactions(current => current.filter(item => item.id !== reaction.id)), 3500);
    await publish({ type: "reaction", emoji, name: reaction.name }, false);
  }

  async function createQuickPoll() {
    if (!manager || !session) return;
    const question = window.prompt("Poll question")?.trim();
    if (!question) return;
    const raw = window.prompt("Answer options separated by commas (2–6 options)")?.trim();
    if (!raw) return;
    const labels = raw.split(",").map(value => value.trim()).filter(Boolean).slice(0, 6);
    if (labels.length < 2) {
      setNotice("A poll needs at least two answer options.");
      return;
    }
    const next: PollState = {
      id: crypto.randomUUID(),
      question: question.slice(0, 240),
      options: labels.map(label => ({ id: crypto.randomUUID(), label: label.slice(0, 120), votes: 0 })),
      open: true,
      voters: {},
    };
    setPoll(next);
    await publish({ type: "poll-start", poll: next }, true);
    void api(`/learning/live-classes/${session.liveClass.id}/interactions`, { method: "POST", body: JSON.stringify({ type: "POLL", content: { id: next.id, question: next.question, options: next.options.map(option => ({ id: option.id, label: option.label })) } }) }).catch(() => undefined);
  }

  async function votePoll(optionId: string) {
    if (!poll || !poll.open || !session || observer) return;
    const voter = user?.id ?? "local";
    if (poll.voters[voter]) return;
    setPoll(current => current ? {
      ...current,
      voters: { ...current.voters, [voter]: optionId },
      options: current.options.map(option => option.id === optionId ? { ...option, votes: option.votes + 1 } : option),
    } : current);
    await publish({ type: "poll-vote", pollId: poll.id, optionId, voter }, true);
    void api(`/learning/live-classes/${session.liveClass.id}/interactions`, { method: "POST", body: JSON.stringify({ type: "POLL_RESPONSE", content: { pollId: poll.id, optionId } }) }).catch(() => undefined);
  }

  async function endPoll() {
    if (!manager || !poll) return;
    setPoll(current => current ? { ...current, open: false } : current);
    await publish({ type: "poll-end", pollId: poll.id }, true);
  }

  async function startClassTimer() {
    if (!manager) return;
    const raw = window.prompt("Countdown minutes", "5");
    if (!raw) return;
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 180) {
      setNotice("Timer must be between 1 and 180 minutes.");
      return;
    }
    const endsAt = Date.now() + Math.round(minutes * 60_000);
    setTimerEndsAt(endsAt);
    await publish({ type: "timer-start", endsAt }, true);
  }

  async function stopClassTimer() {
    if (!manager) return;
    setTimerEndsAt(null);
    await publish({ type: "timer-stop" }, true);
  }

  async function startRecording() {
    try {
      const result = await api(`/learning/live-classes/native/${encodeURIComponent(roomName)}/recording/start`, { method: "POST", body: "{}" });
      setRecording(true);
      setNotice(`Recording started (${result.data.status}).`);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function stopRecording() {
    try {
      const result = await api(`/learning/live-classes/native/${encodeURIComponent(roomName)}/recording/stop`, { method: "POST", body: "{}" });
      setRecording(false);
      setSession(current => current ? { ...current, recordingAvailable: Boolean(result.data.publishedToLms) || current.recordingAvailable } : current);
      setNotice(`Recording stopping (${result.data.status}).${result.data.publishedToLms ? " The recording has been published to LMS and will become playable/downloadable after provider processing completes." : ""}`);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function downloadRecording() {
    try {
      await openAuthenticatedDocument({
        url: `${API}/learning/live-classes/native/${encodeURIComponent(roomName)}/recording`,
        token: getAccessToken() ?? "",
        fileName: `${session?.liveClass.title ?? "live-class"}-recording.mp4`,
        fallbackError: "Class recording is not available yet",
      });
    } catch (cause) { setError(errorMessage(cause)); }
  }

  const elapsed = useMemo(() => {
    if (!session) return "";
    const start = new Date(session.liveClass.startsAt).getTime();
    const end = new Date(session.liveClass.endsAt).getTime();
    const minutes = Math.max(0, Math.round((end - start) / 60000));
    return `${minutes} min scheduled`;
  }, [session]);

  const timerLabel = useMemo(() => {
    if (!timerEndsAt) return "";
    const seconds = Math.max(0, Math.ceil((timerEndsAt - timerNow) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, [timerEndsAt, timerNow]);

  if (loading) return <div className="grid min-h-screen place-items-center bg-slate-950 text-white">Loading native classroom…</div>;
  if (!session) return <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white"><div className="max-w-lg rounded-2xl border border-red-400/30 bg-red-950/50 p-6"><h1 className="text-xl font-bold">Unable to open classroom</h1><p className="mt-2 text-sm text-red-100">{error || "Classroom session could not be created."}</p></div></div>;

  if (!joined) return <div className="min-h-screen bg-slate-950 p-5 text-white">
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[1.4fr_.8fr]">
      <section className="rounded-3xl border border-white/10 bg-slate-900 p-7">
        <div className="flex items-center gap-2 text-blue-300"><ShieldCheck size={18}/><span className="text-xs font-bold uppercase tracking-wider">Being Brilliant Native Classroom</span></div>
        <h1 className="mt-3 text-3xl font-black">{session.liveClass.title}</h1>
        <p className="mt-2 text-slate-300">{session.liveClass.description || "Interactive live class inside the learning portal."}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Preflight label={observer ? "Participation mode" : "Camera & microphone"} value={observer ? "Observer / view only" : deviceCheck === "ok" ? "Ready" : deviceCheck === "failed" ? "Needs attention" : "Not tested"}/>
          <Preflight label="Class duration" value={elapsed}/>
          <Preflight label="Role" value={session.role.replaceAll("_", " ")}/>
        </div>
        {error && <p className="mt-4 rounded-xl bg-red-950 p-3 text-sm text-red-200">{error}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          {!observer && <button onClick={() => void testDevices()} disabled={deviceCheck === "testing"} className="rounded-xl border border-white/20 px-4 py-3 font-semibold">{deviceCheck === "testing" ? "Testing…" : "Test camera & microphone"}</button>}
          {session.recordingAvailable && <button onClick={() => void downloadRecording()} className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-3 font-semibold"><Download size={16}/>Download recording</button>}
          <button onClick={() => void joinClass()} disabled={joining || locked && !manager} className="rounded-xl bg-blue-600 px-5 py-3 font-bold disabled:opacity-50">{joining ? "Joining…" : locked && !manager ? "Class locked" : observer ? "Join as Observer" : "Join Classroom"}</button>
        </div>
      </section>
      <aside className="rounded-3xl border border-white/10 bg-slate-900 p-6">
        <h2 className="font-bold">Classroom capabilities</h2>
        <div className="mt-4 space-y-3 text-sm text-slate-300">
          {(observer?["Live audio/video viewing","Shared screen viewing","Whiteboard viewing","Class chat viewing","Automatic attendance"]:["Camera & microphone","Screen sharing","Collaborative whiteboard with text, shapes & sticky notes","Screen annotations","Chat, reactions & raise hand","Live polls & class timer","Automatic attendance","Teacher moderation",session.recordingConfigured?"Cloud recording enabled":"Recording requires storage configuration"]).map(item=><div key={item} className="flex items-center gap-2"><Circle size={8} className="fill-current text-blue-400"/>{item}</div>)}
        </div>
      </aside>
    </div>
  </div>;

  return <div className="min-h-screen bg-slate-950 text-white">
    <header className="flex flex-col gap-3 border-b border-white/10 bg-slate-900 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div><div className="text-xs font-bold uppercase tracking-wider text-blue-300">Native Live Classroom</div><h1 className="text-lg font-bold">{session.liveClass.title}</h1></div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950 px-3 py-1.5 text-emerald-300"><Wifi size={13}/>Connected · {quality}</span>
        <span className="rounded-full bg-slate-800 px-3 py-1.5">{participants.length} participants</span>
        {timerEndsAt && <span className="rounded-full bg-amber-950 px-3 py-1.5 font-bold text-amber-200">Timer {timerLabel}</span>}
        {recording && <span className="inline-flex items-center gap-1 rounded-full bg-red-950 px-3 py-1.5 text-red-300"><Circle size={10} className="fill-current"/>Recording</span>}
      </div>
    </header>

    {error && <div className="mx-4 mt-3 rounded-xl bg-red-950 p-3 text-sm text-red-200">{error}</div>}
    {notice && <div className="mx-4 mt-3 rounded-xl bg-blue-950 p-3 text-sm text-blue-200">{notice}</div>}

    <div className="grid min-h-[calc(100vh-76px)] lg:grid-cols-[1fr_340px]">
      <main className="relative min-w-0 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button className={`rounded-xl px-4 py-2 text-sm font-semibold ${panel==="class"?"bg-blue-600":"bg-slate-800"}`} onClick={()=>setPanel("class")}>Class</button>
            <button className={`rounded-xl px-4 py-2 text-sm font-semibold ${panel==="whiteboard"?"bg-blue-600":"bg-slate-800"}`} onClick={()=>{setPanel("whiteboard");window.setTimeout(()=>redraw("whiteboard"),50)}}>Whiteboard</button>
          </div>
          {manager && <div className="flex flex-wrap gap-2">
            <button onClick={()=>void classroomControl(locked?"UNLOCK":"LOCK")} className="inline-flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-sm">{locked?<Unlock size={15}/>:<Lock size={15}/>} {locked?"Unlock":"Lock"}</button>
            <button onClick={()=>void toggleStudentDrawing()} className="rounded-xl bg-slate-800 px-3 py-2 text-sm">{studentDrawAllowed?"Disable student board":"Allow student board"}</button>
            <button onClick={()=>void createQuickPoll()} className="rounded-xl bg-slate-800 px-3 py-2 text-sm">Quick poll</button>
            <button onClick={()=>void (timerEndsAt ? stopClassTimer() : startClassTimer())} className="rounded-xl bg-slate-800 px-3 py-2 text-sm">{timerEndsAt?`Stop timer ${timerLabel}`:"Class timer"}</button>
            {session.recordingConfigured && (recording?<button onClick={()=>void stopRecording()} className="inline-flex items-center gap-1 rounded-xl bg-red-700 px-3 py-2 text-sm"><Square size={14}/>Stop recording</button>:<button onClick={()=>void startRecording()} className="inline-flex items-center gap-1 rounded-xl bg-red-700 px-3 py-2 text-sm"><Radio size={14}/>Record</button>)}
            {session.recordingAvailable && <button onClick={()=>void downloadRecording()} className="inline-flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-sm"><Download size={14}/>Recording</button>}
          </div>}
        </div>

        {reactions.length > 0 && <div className="pointer-events-none absolute left-1/2 top-20 z-50 flex -translate-x-1/2 gap-2">
          {reactions.map(reaction => <div key={reaction.id} className="animate-bounce rounded-full border border-white/10 bg-slate-900/90 px-3 py-2 text-center shadow-xl"><div className="text-2xl">{reaction.emoji}</div><div className="max-w-28 truncate text-[10px] text-slate-300">{reaction.name}</div></div>)}
        </div>}

        {panel === "class" ? <div className="relative min-h-[65vh]">
          <div ref={mediaRef} className="grid gap-3 md:grid-cols-2"/>
          <canvas
            ref={annotationRef}
            aria-label="Screen annotation surface"
            className={`absolute inset-0 z-20 h-full w-full touch-none select-none ${annotationMode&&manager?"pointer-events-auto cursor-crosshair":"pointer-events-none"}`}
            style={{ touchAction: "none" }}
            onPointerDown={e=>startDraw("annotation",e)}
            onPointerMove={e=>void moveDraw("annotation",e)}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
            onPointerLeave={endDraw}
          />
          {manager && <div className="absolute right-3 top-3 z-30 flex flex-wrap items-center gap-2 rounded-xl bg-black/80 p-2 shadow-lg">
            <button onClick={()=>{setAnnotationMode(value=>!value);setAnnotationDrawingMode("pen")}} className={`rounded-lg px-3 py-2 text-xs font-semibold ${annotationMode?"bg-blue-600":"bg-slate-800"}`}><PenLine size={14} className="inline"/> {annotationMode?"Annotating":"Annotate"}</button>
            {annotationMode && <>
              <button aria-label="Annotation pen" onClick={()=>setAnnotationDrawingMode("pen")} className={`rounded-lg p-2 ${annotationDrawingMode==="pen"?"bg-blue-600":"bg-slate-800"}`}><PenLine size={14}/></button>
              <button aria-label="Annotation eraser" onClick={()=>setAnnotationDrawingMode("erase")} className={`rounded-lg p-2 ${annotationDrawingMode==="erase"?"bg-blue-600":"bg-slate-800"}`}><Eraser size={14}/></button>
              <input type="color" aria-label="Annotation color" value={annotationColor} onChange={e=>setAnnotationColor(e.target.value)} className="h-8 w-9 rounded bg-slate-800 p-1"/>
              <button aria-label="Clear annotations" onClick={()=>void clearSurface("annotation")} className="rounded-lg bg-slate-800 p-2"><RotateCcw size={14}/></button>
              <span className="rounded bg-red-600/90 px-2 py-1 text-[11px] font-bold">DRAW ON SCREEN</span>
            </>}
          </div>}
        </div> : <section className="relative h-[70vh] overflow-hidden rounded-2xl bg-white">
          <canvas ref={whiteboardRef} className={`h-full w-full touch-none ${canDraw?"cursor-crosshair":"cursor-not-allowed"}`} onPointerDown={e=>startDraw("whiteboard",e)} onPointerMove={e=>void moveDraw("whiteboard",e)} onPointerUp={endDraw} onPointerCancel={endDraw}/>
          <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-xl bg-slate-950/95 p-2 shadow-lg">
            <button aria-label="Whiteboard pen" title="Pen" onClick={()=>setDrawingMode("pen")} className={`rounded-lg p-2 ${drawingMode==="pen"?"bg-blue-600":"bg-slate-800"}`}><PenLine size={16}/></button>
            <button aria-label="Whiteboard eraser" title="Eraser" onClick={()=>setDrawingMode("erase")} className={`rounded-lg p-2 ${drawingMode==="erase"?"bg-blue-600":"bg-slate-800"}`}><Eraser size={16}/></button>
            <input type="color" aria-label="Pen color" title="Pen / object color" value={penColor} onChange={e=>setPenColor(e.target.value)} className="h-9 w-10 rounded bg-slate-800 p-1"/>
            <span className="h-6 w-px bg-white/15"/>
            <button onClick={()=>void insertWhiteboardText("text")} className="rounded-lg bg-slate-800 px-2.5 py-2 text-xs font-semibold">Text</button>
            <button onClick={()=>void insertWhiteboardText("note")} className="rounded-lg bg-amber-700 px-2.5 py-2 text-xs font-semibold">Sticky</button>
            <button onClick={()=>void insertWhiteboardShape("rectangle")} className="rounded-lg bg-slate-800 px-2.5 py-2 text-xs font-semibold">Rectangle</button>
            <button onClick={()=>void insertWhiteboardShape("circle")} className="rounded-lg bg-slate-800 px-2.5 py-2 text-xs font-semibold">Circle</button>
            <button onClick={()=>void insertWhiteboardShape("arrow")} className="rounded-lg bg-slate-800 px-2.5 py-2 text-xs font-semibold">Arrow</button>
            {manager && <><span className="h-6 w-px bg-white/15"/><button title="Undo" onClick={()=>void undoWhiteboard()} className="rounded-lg bg-slate-800 px-2.5 py-2 text-xs">Undo</button><button title="Redo" onClick={()=>void redoWhiteboard()} className="rounded-lg bg-slate-800 px-2.5 py-2 text-xs">Redo</button></>}
            {manager && <button title="Clear whiteboard" onClick={()=>void clearSurface("whiteboard")} className="rounded-lg bg-slate-800 p-2"><RotateCcw size={16}/></button>}
            {manager && <button title="Save whiteboard" onClick={()=>void saveWhiteboard()} className="rounded-lg bg-slate-800 p-2"><Save size={16}/></button>}
            <button title="Download PNG" onClick={downloadWhiteboard} className="rounded-lg bg-slate-800 p-2"><Download size={16}/></button>
          </div>
        </section>}

        <div className="sticky bottom-4 z-40 mx-auto mt-4 flex w-fit flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900/95 p-2 shadow-2xl">
          {!observer && <><Control active={micOn} label={micOn?"Mute":"Mic"} onClick={()=>void toggleMic()} icon={micOn?<Mic/>:<MicOff/>}/>
          <Control active={cameraOn} label={cameraOn?"Camera":"Camera"} onClick={()=>void toggleCamera()} icon={cameraOn?<Camera/>:<CameraOff/>}/>
          <Control active={screenOn} label="Share" onClick={()=>void toggleScreen()} icon={<MonitorUp/>}/>
          <Control active={handRaised} label={handRaised?"Lower":"Raise hand"} onClick={()=>void toggleHand()} icon={<Hand/>}/>
          <div className="flex items-center gap-1 rounded-xl bg-slate-800 px-2 py-2" aria-label="Class reactions">
            {["👍","👏","❤️","🎉"].map(emoji=><button key={emoji} title={`React ${emoji}`} onClick={()=>void sendReaction(emoji)} className="rounded-lg px-1.5 py-1 text-lg hover:bg-slate-700">{emoji}</button>)}
          </div></>}
          <button onClick={()=>void leaveClass()} className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-sm font-bold"><LogOut size={17}/>Leave</button>
        </div>
      </main>

      <aside className="border-l border-white/10 bg-slate-900">
        <div className="border-b border-white/10 p-4">
          <h2 className="flex items-center gap-2 font-bold"><Users size={17}/>Participants</h2>
          <div className="mt-3 max-h-56 space-y-2 overflow-auto">
            {participants.map(participant=><div key={participant.identity} className="rounded-xl bg-slate-800 p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{participant.name}</span>{hands[participant.identity]&&<Hand size={15} className="text-amber-300"/>}</div>
              {manager && participant.identity !== user?.id && <div className="mt-2 flex flex-wrap gap-1">
                {participant.micTrackSid&&<button onClick={()=>void classroomControl("MUTE_TRACK",participant.identity,participant.micTrackSid)} className="rounded bg-slate-700 px-2 py-1 text-xs">Mute</button>}
                <button onClick={()=>void classroomControl("ALLOW_SCREEN_SHARE",participant.identity)} className="rounded bg-slate-700 px-2 py-1 text-xs">Allow share</button>
                <button onClick={()=>void classroomControl("REVOKE_SCREEN_SHARE",participant.identity)} className="rounded bg-slate-700 px-2 py-1 text-xs">Revoke share</button>
                <button onClick={()=>void classroomControl("REMOVE_PARTICIPANT",participant.identity)} className="rounded bg-red-950 px-2 py-1 text-xs text-red-200"><UserMinus size={12} className="inline"/> Remove</button>
              </div>}
            </div>)}
          </div>
        </div>

        {poll && <div className="border-b border-white/10 p-4">
          <div className="flex items-start justify-between gap-2"><div><div className="text-[10px] font-bold uppercase tracking-wider text-blue-300">Live poll</div><h2 className="mt-1 text-sm font-bold">{poll.question}</h2></div>{manager&&poll.open&&<button onClick={()=>void endPoll()} className="rounded-lg bg-slate-800 px-2 py-1 text-xs">End</button>}</div>
          <div className="mt-3 space-y-2">
            {poll.options.map(option=>{
              const total=Math.max(1,poll.options.reduce((sum,item)=>sum+item.votes,0));
              const percent=Math.round(option.votes*100/total);
              const voted=Boolean(poll.voters[user?.id??"local"]);
              return <button key={option.id} disabled={!poll.open||observer||voted} onClick={()=>void votePoll(option.id)} className="relative block w-full overflow-hidden rounded-lg bg-slate-800 px-3 py-2 text-left text-xs disabled:cursor-default">
                <span className="absolute inset-y-0 left-0 bg-blue-900/60" style={{width:`${percent}%`}}/>
                <span className="relative flex justify-between gap-2"><span>{option.label}</span><b>{option.votes}</b></span>
              </button>;
            })}
          </div>
          <div className="mt-2 text-[10px] text-slate-400">{poll.open?"Poll open":"Poll ended"} · {Object.keys(poll.voters).length} responses</div>
        </div>}

        <div className="flex h-[calc(100vh-350px)] min-h-80 flex-col p-4">
          <h2 className="flex items-center gap-2 font-bold"><MessageSquare size={17}/>Class chat</h2>
          <div className="mt-3 flex-1 space-y-2 overflow-auto">
            {chat.map(message=><div key={message.id} className={`rounded-xl p-2 text-sm ${message.self?"bg-blue-950":"bg-slate-800"}`}><b className="text-xs text-blue-300">{message.name}</b><p className="mt-1 break-words">{message.text}</p></div>)}
            {!chat.length&&<p className="text-sm text-slate-500">No messages yet.</p>}
          </div>
          {observer?<p className="mt-3 rounded-xl bg-slate-800 p-3 text-xs text-slate-400">Observer mode: class chat is view-only.</p>:<div className="mt-3 flex gap-2"><input value={chatText} onChange={e=>setChatText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void sendChat()}} placeholder="Message class" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm outline-none"/><button onClick={()=>void sendChat()} className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold">Send</button></div>}
        </div>
      </aside>
    </div>
    <div ref={audioRef} className="hidden"/>
  </div>;
}

function Control({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${active?"bg-blue-600":"bg-slate-800"}`}>{icon}<span className="hidden sm:inline">{label}</span></button>;
}
function Preflight({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-slate-950 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}
