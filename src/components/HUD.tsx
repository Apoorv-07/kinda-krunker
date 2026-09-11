"use client";

// ---------------------------------------------------------------------------
// HUD + overlays for BLOCKSHOT ARENA. Purely presentational; driven by the
// engine's HudSnapshot and parent state.
// ---------------------------------------------------------------------------

import { EngineSettings, GameOverStats, HudSnapshot } from "@/lib/game/engine";
import { MAP_LABEL, WEAPONS } from "@/lib/game/config";

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const DIFF_LABEL: Record<string, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };

export function Crosshair({ hud }: { hud: HudSnapshot }) {
  if (hud.scoped) return null;
  const color = hud.protectedT > 0 ? "#3ddc84" : "#ffffff";
  const gap = 11;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="relative h-14 w-14" style={{ mixBlendMode: "difference" }}>
        <span className="absolute" style={{ width: 2, height: 10, left: "50%", top: gap, transform: "translateX(-50%)", background: color }} />
        <span className="absolute" style={{ width: 2, height: 10, left: "50%", bottom: gap, transform: "translateX(-50%)", background: color }} />
        <span className="absolute" style={{ height: 2, width: 10, top: "50%", left: gap, transform: "translateY(-50%)", background: color }} />
        <span className="absolute" style={{ height: 2, width: 10, top: "50%", right: gap, transform: "translateY(-50%)", background: color }} />
        <span className="absolute" style={{ width: 3, height: 3, borderRadius: 99, left: "50%", top: "50%", transform: "translate(-50%,-50%)", background: color }} />
      </div>
    </div>
  );
}

export function Hitmarker({ hud }: { hud: HudSnapshot }) {
  if (hud.hitKey === 0) return null;
  const kind = hud.hitKind;
  const color = kind === 3 ? "#ff3b3b" : kind === 2 ? "#ff5555" : "#ffffff";
  const scale = kind === 3 ? 1.5 : kind === 2 ? 1.25 : 1;
  return (
    <div key={hud.hitKey} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div
        className="hitmarker-anim relative h-10 w-10"
        style={{ transform: `scale(${scale})` }}
      >
        {[45, -45].map((r) => (
          <div key={r} className="absolute left-1/2 top-1/2 h-[3px] w-7" style={{ background: color, transform: `translate(-50%,-50%) rotate(${r}deg)`, boxShadow: "0 0 6px rgba(0,0,0,0.6)" }} />
        ))}
      </div>
    </div>
  );
}

export function DamageVignette({ hud }: { hud: HudSnapshot }) {
  const amp = Math.min(1, hud.dmgAmp);
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          opacity: amp * 0.85,
          background: "radial-gradient(ellipse at center, transparent 35%, rgba(220,30,30,0.55) 100%)",
          transition: "opacity 90ms linear",
        }}
      />
      {amp > 0.05 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div
            style={{
              transform: `rotate(${(hud.dmgAngle * 180) / Math.PI}deg) translateY(-110px)`,
              opacity: amp,
            }}
          >
            <svg width="44" height="44" viewBox="0 0 44 44">
              <path d="M22 4 L30 22 L22 18 L14 22 Z" fill="#ff4040" stroke="#000" strokeWidth="1.5" />
            </svg>
          </div>
        </div>
      )}
      {hud.hp > 0 && hud.hp <= 30 && (
        <div className="lowhp-pulse pointer-events-none absolute inset-0 z-10" style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(220,20,20,0.35) 100%)" }} />
      )}
    </>
  );
}

export function KillFeed({ hud }: { hud: HudSnapshot }) {
  return (
    <div className="pointer-events-none absolute right-3 top-14 z-20 flex w-64 flex-col items-end gap-1 sm:top-3 sm:w-72">
      {hud.feed.map((f) => (
        <div
          key={f.id}
          className={`feed-item rounded border-l-2 bg-black/55 px-2.5 py-1 text-[11px] font-bold tracking-wide backdrop-blur-sm sm:text-xs ${
            f.mine ? "border-amber-400 text-amber-300" : "border-red-400/70 text-red-200"
          }`}
        >
          {f.head && <span className="mr-1 text-red-400">✖</span>}
          <span className="text-white">{f.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Announcement({ hud }: { hud: HudSnapshot }) {
  if (!hud.announceText || hud.announceKey === 0) return null;
  return (
    <div key={hud.announceKey} className="pointer-events-none absolute inset-x-0 top-[22%] z-20 flex flex-col items-center">
      <div className="announce-anim text-center">
        <div className="text-4xl font-black italic tracking-wider text-amber-400 sm:text-5xl" style={{ textShadow: "0 3px 0 rgba(0,0,0,0.55), 0 0 26px rgba(251,191,36,0.45)" }}>
          {hud.announceText}
        </div>
        {hud.announceSub && <div className="mt-1 text-sm font-bold uppercase tracking-[0.25em] text-white/85">{hud.announceSub}</div>}
      </div>
    </div>
  );
}

export function TopBar({ hud }: { hud: HudSnapshot }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/55 px-4 py-1.5 backdrop-blur-sm">
        <div className="text-center">
          <div className="text-[9px] font-bold uppercase tracking-widest text-white/50">Time</div>
          <div className={`font-mono text-lg font-bold leading-none ${hud.timeLeft < 30 && hud.state === "playing" ? "text-red-400" : "text-white"}`}>
            {fmtTime(hud.timeLeft)}
          </div>
        </div>
        <div className="h-7 w-px bg-white/15" />
        <div className="text-center">
          <div className="text-[9px] font-bold uppercase tracking-widest text-white/50">Score</div>
          <div className="font-mono text-lg font-bold leading-none text-amber-400">{hud.score}</div>
        </div>
        {hud.scoreLimit > 0 && (
          <>
            <div className="h-7 w-px bg-white/15" />
            <div className="text-center">
              <div className="text-[9px] font-bold uppercase tracking-widest text-white/50">Target</div>
              <div className="font-mono text-lg font-bold leading-none text-white/80">{hud.scoreLimit}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function PlayerStats({ hud }: { hud: HudSnapshot }) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-col gap-1">
      <div className="rounded-lg border border-white/10 bg-black/55 px-3 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-3 font-mono text-xs font-bold sm:text-sm">
          <span className="text-white"><span className="text-emerald-400">{hud.kills}</span> K</span>
          <span className="text-white/40">/</span>
          <span className="text-white"><span className="text-red-400">{hud.deaths}</span> D</span>
          {hud.streak >= 2 && <span className="rounded bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-black text-black">×{hud.streak} STREAK</span>}
        </div>
      </div>
      {hud.protectedT > 0 && (
        <div className="w-fit rounded-md border border-emerald-400/50 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
          Shield {hud.protectedT.toFixed(1)}s
        </div>
      )}
    </div>
  );
}

export function HealthAmmo({ hud }: { hud: HudSnapshot }) {
  const low = hud.hp <= 30;
  return (
    <>
      {/* health */}
      <div className="pointer-events-none absolute bottom-4 left-3 z-20 sm:bottom-6 sm:left-6">
        <div className="flex items-end gap-2">
          <span className="text-4xl font-black leading-none text-white sm:text-5xl" style={{ textShadow: "0 2px 0 rgba(0,0,0,0.6)" }}>
            {hud.hp}
          </span>
          <div className="mb-1 h-3.5 w-32 overflow-hidden rounded-sm border border-white/25 bg-black/55 sm:w-44">
            <div
              className={`h-full transition-[width] duration-150 ${low ? "bg-red-500" : "bg-gradient-to-r from-emerald-500 to-emerald-300"}`}
              style={{ width: `${Math.max(0, hud.hp)}%` }}
            />
          </div>
        </div>
        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">Health</div>
      </div>
      {/* ammo */}
      <div className="pointer-events-none absolute bottom-4 right-3 z-20 text-right sm:bottom-6 sm:right-6">
        <div className="flex items-baseline justify-end gap-2">
          <span className={`text-4xl font-black leading-none sm:text-5xl ${hud.mag === 0 ? "text-red-400" : "text-white"}`} style={{ textShadow: "0 2px 0 rgba(0,0,0,0.6)" }}>
            {hud.mag}
          </span>
          <span className="font-mono text-lg font-bold text-white/55">/ {hud.reserve}</span>
        </div>
        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">{hud.weaponName}</div>
        {hud.reloadT > 0 && (
          <div className="ml-auto mt-1.5 h-1.5 w-28 overflow-hidden rounded-sm bg-black/60">
            <div className="h-full bg-amber-400" style={{ width: `${(1 - hud.reloadT / hud.reloadDur) * 100}%` }} />
          </div>
        )}
      </div>
    </>
  );
}

export function Warmup({ hud }: { hud: HudSnapshot }) {
  if (hud.state !== "warmup") return null;
  const n = Math.ceil(hud.warmup);
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/25">
      <div key={n} className="countdown-anim text-center">
        <div className="text-[120px] font-black leading-none text-white" style={{ textShadow: "0 6px 0 rgba(0,0,0,0.5), 0 0 60px rgba(251,191,36,0.5)" }}>
          {n}
        </div>
        <div className="mt-2 text-sm font-bold uppercase tracking-[0.5em] text-amber-300">Get ready</div>
      </div>
    </div>
  );
}

export function ScopeOverlay({ hud }: { hud: HudSnapshot }) {
  if (!hud.scoped) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(circle at center, transparent 26%, rgba(0,0,0,0.97) 27.5%)" }}
      />
      <div className="absolute left-1/2 top-1/2 h-px w-[56%] -translate-x-1/2 -translate-y-1/2 bg-black/80" />
      <div className="absolute left-1/2 top-1/2 h-[56%] w-px -translate-x-1/2 -translate-y-1/2 bg-black/80" />
    </div>
  );
}

export function Scoreboard({ hud }: { hud: HudSnapshot }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-white/15 bg-slate-950/90 shadow-2xl">
        <div className="border-b border-white/10 bg-white/5 px-4 py-2 text-center text-xs font-black uppercase tracking-[0.35em] text-amber-400">
          Scoreboard
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-white/45">
              <th className="px-4 py-1.5 font-bold">Player</th>
              <th className="px-2 py-1.5 text-center font-bold">K</th>
              <th className="px-2 py-1.5 text-center font-bold">D</th>
              <th className="px-4 py-1.5 text-right font-bold">Score</th>
            </tr>
          </thead>
          <tbody>
            {hud.standings.map((s, i) => (
              <tr key={i} className={`border-t border-white/5 ${s.isPlayer ? "bg-amber-400/10" : ""}`}>
                <td className="px-4 py-1.5 font-bold" style={{ color: s.isPlayer ? "#fbbf24" : "#" + s.color.toString(16).padStart(6, "0") }}>
                  {s.name} {s.isPlayer && <span className="ml-1 rounded bg-amber-400 px-1 text-[9px] font-black text-black">YOU</span>}
                </td>
                <td className="px-2 py-1.5 text-center font-mono text-white">{s.kills}</td>
                <td className="px-2 py-1.5 text-center font-mono text-white/60">{s.deaths}</td>
                <td className="px-4 py-1.5 text-right font-mono font-bold text-white">{s.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DeathOverlay({ hud }: { hud: HudSnapshot }) {
  if (hud.state !== "playing" || hud.hp > 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-red-950/40">
      <div className="text-center">
        <div className="text-5xl font-black italic tracking-wider text-red-400" style={{ textShadow: "0 4px 0 rgba(0,0,0,0.6)" }}>
          ELIMINATED
        </div>
        <div className="mt-2 text-sm font-bold uppercase tracking-[0.3em] text-white/80">
          by <span className="text-red-300">{hud.killerName || "unknown"}</span>
        </div>
        <div className="mx-auto mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-black/60">
          <div className="h-full bg-red-400 transition-[width] duration-100" style={{ width: `${(hud.deadT / 2.6) * 100}%` }} />
        </div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/50">Respawning</div>
      </div>
    </div>
  );
}

export function PauseOverlay({
  hud, onResume, onRestart, onQuit, settings, onSettings,
}: {
  hud: HudSnapshot;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  settings: EngineSettings;
  onSettings: (s: EngineSettings) => void;
}) {
  if (hud.state !== "paused") return null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900/95 p-6 shadow-2xl">
        <h2 className="text-center text-2xl font-black uppercase tracking-[0.3em] text-amber-400">Paused</h2>
        <div className="mt-5 space-y-4">
          <Slider label="Sensitivity" value={settings.sens} min={0.3} max={2.5} step={0.05}
            onChange={(v) => onSettings({ ...settings, sens: v })} fmt={(v) => v.toFixed(2)} />
          <Slider label="Field of View" value={settings.fov} min={75} max={110} step={1}
            onChange={(v) => onSettings({ ...settings, fov: v })} fmt={(v) => `${v}°`} />
          <Slider label="Volume" value={settings.volume} min={0} max={1} step={0.05}
            onChange={(v) => onSettings({ ...settings, volume: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <span className="text-sm font-bold text-white/85">Mobile auto-fire</span>
            <input
              type="checkbox"
              checked={settings.autoFire}
              onChange={(e) => onSettings({ ...settings, autoFire: e.target.checked })}
              className="h-5 w-5 accent-amber-400"
            />
          </label>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2">
          <button onClick={onResume} className="rounded-lg bg-amber-400 px-3 py-2.5 text-sm font-black uppercase tracking-wider text-black transition hover:bg-amber-300 active:scale-95">
            Resume
          </button>
          <button onClick={onRestart} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm font-black uppercase tracking-wider text-white transition hover:bg-white/20 active:scale-95">
            Restart
          </button>
          <button onClick={onQuit} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm font-black uppercase tracking-wider text-white transition hover:bg-white/20 active:scale-95">
            Quit
          </button>
        </div>
        <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-widest text-white/40">
          WASD move · Mouse look · Space jump · Shift sprint · C crouch/slide · R reload · 1-4 weapons · Tab scores
        </p>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-bold">
        <span className="uppercase tracking-widest text-white/70">{label}</span>
        <span className="font-mono text-amber-300">{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-400"
      />
    </div>
  );
}

export function GameOverOverlay({
  stats, onRestart, onQuit, saved,
}: {
  stats: GameOverStats;
  onRestart: () => void;
  onQuit: () => void;
  saved: boolean;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-slate-900/95 p-6 shadow-2xl">
        <div className={`text-center text-4xl font-black italic tracking-wider ${stats.won ? "text-amber-400" : "text-red-400"}`}
          style={{ textShadow: "0 4px 0 rgba(0,0,0,0.6)" }}>
          {stats.won ? "VICTORY" : "DEFEAT"}
        </div>
        <div className="mt-1 text-center text-xs font-bold uppercase tracking-[0.3em] text-white/60">
          {stats.mapLabel} · Lobby {stats.lobbyCode} · Winner <span className="text-white">{stats.winnerName}</span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Stat label="Kills" value={String(stats.player.kills)} accent="text-emerald-400" />
          <Stat label="Deaths" value={String(stats.player.deaths)} accent="text-red-400" />
          <Stat label="Score" value={String(stats.player.score)} accent="text-amber-400" />
          <Stat label="Damage" value={String(stats.player.dmg)} accent="text-cyan-300" />
          <Stat label="Accuracy" value={`${stats.player.acc}%`} accent="text-fuchsia-300" />
          <Stat label="Best Streak" value={`×${stats.player.bestStreak}`} accent="text-orange-300" />
        </div>

        <div className="mt-5 max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-black/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-white/45">
                <th className="px-3 py-1.5 font-bold">#</th>
                <th className="px-1 py-1.5 font-bold">Player</th>
                <th className="px-2 py-1.5 text-center font-bold">K</th>
                <th className="px-2 py-1.5 text-center font-bold">D</th>
                <th className="px-3 py-1.5 text-right font-bold">Score</th>
              </tr>
            </thead>
            <tbody>
              {stats.standings.map((s, i) => (
                <tr key={i} className={`border-t border-white/5 ${s.isPlayer ? "bg-amber-400/10" : ""}`}>
                  <td className="px-3 py-1 font-mono text-white/50">{i + 1}</td>
                  <td className="px-1 py-1 font-bold" style={{ color: s.isPlayer ? "#fbbf24" : "#" + s.color.toString(16).padStart(6, "0") }}>
                    {s.name} {s.isPlayer && <span className="ml-1 rounded bg-amber-400 px-1 text-[9px] font-black text-black">YOU</span>}
                  </td>
                  <td className="px-2 py-1 text-center font-mono text-white">{s.kills}</td>
                  <td className="px-2 py-1 text-center font-mono text-white/60">{s.deaths}</td>
                  <td className="px-3 py-1 text-right font-mono font-bold text-white">{s.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={onRestart} className="flex-1 rounded-lg bg-amber-400 px-3 py-3 text-sm font-black uppercase tracking-wider text-black transition hover:bg-amber-300 active:scale-95">
            Play Again
          </button>
          <button onClick={onQuit} className="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-3 text-sm font-black uppercase tracking-wider text-white transition hover:bg-white/20 active:scale-95">
            Back to Menu
          </button>
        </div>
        {saved && <div className="mt-2 text-center text-[10px] font-bold uppercase tracking-widest text-emerald-400">✓ Score saved to leaderboard</div>}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-2.5">
      <div className={`font-mono text-xl font-black leading-none ${accent}`}>{value}</div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-white/50">{label}</div>
    </div>
  );
}

export function FpsCounter({ hud }: { hud: HudSnapshot }) {
  return (
    <div className="pointer-events-none absolute bottom-1 right-2 z-10 font-mono text-[10px] font-bold text-white/40">
      {hud.fps} FPS · {hud.playerCount}P
    </div>
  );
}
