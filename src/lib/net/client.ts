"use client";

// ---------------------------------------------------------------------------
// Multiplayer client. Owns the polling loop, the local identity, and the
// interpolation buffers for remote players and host-published bots.
// ---------------------------------------------------------------------------

import type {
  HostSnapshot,
  NetBot,
  NetEvent,
  NetPlayer,
  SyncRequest,
  SyncResponse,
} from "./protocol";
import { NET } from "./protocol";

const PID_KEY = "bs_player_id";
const STACK_KEY = "bs_stack_id";

export function getPlayerId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(PID_KEY);
  if (!id) {
    id =
      "pl-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(PID_KEY, id);
  }
  return id;
}

/** Stable per-browser stack id (used for solo lobbies). */
export function getLocalStackId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(STACK_KEY);
  if (!id) {
    id = "s-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(STACK_KEY, id);
  }
  return id;
}

export interface RemoteSample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Interpolated transform handed to the renderer. */
export interface SampleOut {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Interpolated view of one remote entity. */
class Interp {
  a: RemoteSample | null = null;
  b: RemoteSample | null = null;
  /** Render-time extrapolation when starved of samples. */
  sample(renderTime: number, out: SampleOut): void {
    if (!this.a && !this.b) return;
    if (!this.b) {
      this.copy(this.a!, out);
      return;
    }
    if (!this.a) {
      this.copy(this.b, out);
      return;
    }
    const span = this.b.t - this.a.t;
    const target = this.b.t - NET.TICK_MS * 1.5; // render slightly behind to smooth jitter
    if (span <= 1) {
      this.copy(this.b, out);
      return;
    }
    let k = (target - this.a.t) / span;
    k = k < 0 ? 0 : k > 1.6 ? 1.6 : k;
    out.x = this.a.x + (this.b.x - this.a.x) * k;
    out.y = this.a.y + (this.b.y - this.a.y) * k;
    out.z = this.a.z + (this.b.z - this.a.z) * k;
    out.yaw = lerpAngle(this.a.yaw, this.b.yaw, k);
    out.pitch = this.a.pitch + (this.b.pitch - this.a.pitch) * k;
    void renderTime;
  }
  push(s: RemoteSample) {
    if (this.b && s.t <= this.b.t) return; // out of order
    this.a = this.b;
    this.b = s;
  }
  private copy(s: RemoteSample, out: SampleOut) {
    out.x = s.x;
    out.y = s.y;
    out.z = s.z;
    out.yaw = s.yaw;
    out.pitch = s.pitch;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export type NetStatus = "idle" | "connecting" | "waiting" | "live" | "error";

export interface MultiplayerCallbacks {
  onState: (
    players: NetPlayer[],
    bots: NetBot[],
    hostId: string | null,
    lobby: SyncResponse["lobby"],
    teamScores: Array<{ team: number; score: number }>,
  ) => void;
  onEvents: (events: NetEvent[]) => void;
  onStatus: (status: NetStatus, detail?: string) => void;
  onMatchOver: () => void;
}

export interface LocalStateOut {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  weapon: string;
  deaths: number;
  streak: number;
}

export class MultiplayerClient {
  private code: string;
  private playerId: string;
  private stackId: string;
  private cb: MultiplayerCallbacks;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private stopped = false;

  hostId: string | null = null;
  lobby: SyncResponse["lobby"] | null = null;
  players: NetPlayer[] = [];
  status: NetStatus = "idle";
  /** Sequence numbers already applied — avoids double-applying events. */
  private ackSeq = 0;
  private pendingDeath: {
    killedBy?: string;
    killedByBotId?: number;
    headshot?: boolean;
  } | null = null;
  /** Outgoing damage claims, keyed by target playerId. */
  private outgoingHits: Array<{ to: string; dmg: number; head: boolean }> = [];
  /** Feed lines generated locally by the host (forwarded in its snapshot). */
  hostFeed: NetEvent[] = [];
  private hostFeedSeq = 1;

  // interpolation state
  playerInterp = new Map<string, Interp>();
  botInterp = new Map<number, Interp>();

  /** Live HP of remote players, applied by the victim's own report. */
  private latest: SyncResponse | null = null;
  /** Scoreboard rows from the most recent sync, shaped for the results screen. */
  lastStandings: Array<{
    name: string;
    color: number;
    kills: number;
    deaths: number;
    score: number;
    isPlayer: boolean;
    team: number;
  }> = [];
  /** Queued damage against host-simulated bots (guests only). */
  private queuedBotHits: Array<{ botId: number; dmg: number; head: boolean }> =
    [];

  constructor(
    code: string,
    playerId: string,
    stackId: string,
    cb: MultiplayerCallbacks,
  ) {
    this.code = code;
    this.playerId = playerId;
    this.stackId = stackId;
    this.cb = cb;
  }

  get isHost(): boolean {
    return this.hostId !== null && this.hostId === this.playerId;
  }

  async join(name: string): Promise<{ ok: boolean; error?: string; team?: number }> {
    this.setStatus("connecting");
    try {
      const res = await fetch(`/api/lobbies/${this.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: this.playerId,
          name,
          stackId: this.stackId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.setStatus("error", data.error ?? "Could not join lobby");
        return { ok: false, error: data.error ?? "Could not join lobby" };
      }
      this.lobby = data.lobby;
      this.hostId = data.hostId;
      this.players = data.players ?? [];
      this.setStatus(data.lobby.status === "live" ? "live" : "waiting");
      return { ok: true, team: data.player?.team };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setStatus("error", msg);
      return { ok: false, error: msg };
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), NET.TICK_MS);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Best-effort leave.
    try {
      void fetch(`/api/lobbies/${this.code}/join`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: this.playerId }),
        keepalive: true,
      });
    } catch {}
  }

  /** Shooter claims a hit on a remote player. The victim applies it. */
  reportHit(targetPlayerId: string, dmg: number, head: boolean): void {
    this.outgoingHits.push({ to: targetPlayerId, dmg, head });
  }

  /** Victim reports its own death so the server can credit the killer. */
  reportDeath(byPlayerId?: string, byBotId?: number, headshot?: boolean): void {
    this.pendingDeath = {
      killedBy: byPlayerId,
      killedByBotId: byBotId,
      headshot,
    };
  }

  /** Guest → host relay: damage dealt to a host-simulated bot. */
  reportBotHit(botId: number, dmg: number, head: boolean): void {
    this.queuedBotHits.push({ botId, dmg, head });
    if (this.queuedBotHits.length > 30)
      this.queuedBotHits.splice(0, this.queuedBotHits.length - 30);
  }

  /** Host: queue a feed line for broadcast. */
  pushFeed(text: string, head: boolean, from?: string, to?: string): void {
    this.hostFeed.push({
      seq: this.hostFeedSeq++,
      kind: "feed",
      text,
      head,
      from,
      to,
    });
    if (this.hostFeed.length > 24)
      this.hostFeed.splice(0, this.hostFeed.length - 24);
  }

  private setStatus(s: NetStatus, detail?: string) {
    this.status = s;
    this.cb.onStatus(s, detail);
  }

  private async tick(): Promise<void> {
    if (this.inFlight || this.stopped) return;
    this.inFlight = true;
    try {
      const body: SyncRequest = {
        playerId: this.playerId,
        transform: this.readLocal(),
        ackSeq: this.ackSeq,
      };
      if (this.pendingDeath) {
        body.killedBy = this.pendingDeath.killedBy ?? null;
        body.killedByBotId = this.pendingDeath.killedByBotId ?? null;
      }

      // Host publishes the world.
      if (this.isHost && this.snapshotProvider) {
        body.snapshot = this.snapshotProvider();
      }

      const res = await fetch(`/api/lobbies/${this.code}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as SyncResponse & { error?: string };
      if (!res.ok) {
        this.setStatus("error", data.error ?? "Sync failed");
        return;
      }

      this.latest = data;
      this.lobby = data.lobby;
      const prevHost = this.hostId;
      this.hostId = data.hostId;
      this.players = data.players ?? [];

      // Host migration: if we were host and no longer are, hand off.
      if (
        prevHost === this.playerId &&
        this.hostId !== this.playerId &&
        this.onHostLost
      ) {
        this.onHostLost();
      }
      if (
        prevHost !== this.playerId &&
        this.hostId === this.playerId &&
        this.onHostGained
      ) {
        this.onHostGained();
      }

      this.ingestRemote(data.players ?? []);
      this.ingestBots(data.bots ?? []);

      const evs = data.events ?? [];
      if (evs.length) {
        let maxSeq = this.ackSeq;
        for (const e of evs) if (e.seq > maxSeq) maxSeq = e.seq;
        this.ackSeq = maxSeq;
        this.applyEvents(evs);
      }

      this.cb.onState(
        this.players,
        data.bots ?? [],
        this.hostId,
        data.lobby,
        data.teamScores ?? [],
      );
      this.setStatus(data.lobby.status === "live" ? "live" : "waiting");
      if (data.matchOver && this.status === "live") this.cb.onMatchOver();
    } catch {
      // Transient network error — keep polling, the UI shows the last good state.
    } finally {
      this.inFlight = false;
    }
  }

  /** Fill from the React layer (the engine owns the live transform). */
  readLocalFn: (() => LocalStateOut) | null = null;
  snapshotProvider: (() => HostSnapshot) | null = null;
  onHostLost: (() => void) | null = null;
  onHostGained: (() => void) | null = null;
  onDamage: ((dmg: number, fromName: string, head: boolean) => void) | null =
    null;
  onKillFeed: ((text: string, head: boolean) => void) | null = null;
  onStart: (() => void) | null = null;
  /** Host only: guest damage claims against its bots. */
  onBotHits:
    | ((hits: Array<{ botId: number; dmg: number; head: boolean }>) => void)
    | null = null;

  private readLocal(): LocalStateOut {
    if (this.readLocalFn) return this.readLocalFn();
    return {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      hp: 100,
      alive: true,
      weapon: "ar",
      deaths: 0,
      streak: 0,
    };
  }

  private ingestRemote(players: NetPlayer[]): void {
    const now = Date.now();
    for (const p of players) {
      if (p.playerId === this.playerId) continue;
      let it = this.playerInterp.get(p.playerId);
      if (!it) {
        it = new Interp();
        this.playerInterp.set(p.playerId, it);
      }
      it.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
    }
    // Forget players that left.
    const ids = new Set(players.map((p) => p.playerId));
    for (const key of [...this.playerInterp.keys()])
      if (!ids.has(key)) this.playerInterp.delete(key);
  }

  private ingestBots(bots: NetBot[]): void {
    const now = Date.now();
    for (const b of bots) {
      let it = this.botInterp.get(b.id);
      if (!it) {
        it = new Interp();
        this.botInterp.set(b.id, it);
      }
      it.push({ t: now, x: b.x, y: b.y, z: b.z, yaw: b.yaw, pitch: b.pitch });
    }
    for (const key of [...this.botInterp.keys()])
      if (!bots.some((b) => b.id === key)) this.botInterp.delete(key);
  }

  private applyEvents(events: NetEvent[]): void {
    for (const e of events) {
      if (e.kind === "dmg" && e.to === this.playerId) {
        this.onDamage?.(e.dmg ?? 0, e.fromName ?? "enemy", !!e.head);
      } else if (e.kind === "feed") {
        this.onKillFeed?.(e.text ?? "", !!e.head);
      } else if (e.kind === "start") {
        this.onStart?.();
      }
    }
  }

  /** Consume outgoing hits (called by the host when it flushes its snapshot). */
  drainHits(): NetEvent[] {
    const out = this.outgoingHits.map((h, i) => ({
      seq: -(i + 1), // host renumbers on the server
      kind: "dmg" as const,
      to: h.to,
      from: this.playerId,
      dmg: h.dmg,
      head: h.head,
    }));
    this.outgoingHits = [];
    return out;
  }

  get snapshot(): SyncResponse | null {
    return this.latest;
  }
}
