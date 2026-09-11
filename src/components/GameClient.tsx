"use client";

// ---------------------------------------------------------------------------
// React shell around the GameEngine: canvas lifecycle, keyboard / mouse /
// touch input, mobile virtual controls, pause + scoreboard + game-over wiring.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { EngineSettings, GameEngine, GameOverStats, HudSnapshot } from "@/lib/game/engine";
import { LobbyConfig, WEAPON_ORDER } from "@/lib/game/config";
import { sfx } from "@/lib/game/audio";
import {
  Announcement, Crosshair, DamageVignette, DeathOverlay, FpsCounter, GameOverOverlay,
  HealthAmmo, Hitmarker, KillFeed, PauseOverlay, PlayerStats, ScopeOverlay, Scoreboard,
  TopBar, Warmup,
} from "./HUD";

interface Props {
  config: LobbyConfig;
  playerName: string;
  onExit: () => void;
}

export default function GameClient({ config, playerName, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [paused, setPaused] = useState(false);
  const [over, setOver] = useState<GameOverStats | null>(null);
  const [savedScore, setSavedScore] = useState(false);
  const [scoreboard, setScoreboard] = useState(false);
  const [started, setStarted] = useState(false);
  const [isMobile] = useState(
    () => typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768),
  );
  const [settings, setSettings] = useState<EngineSettings>({
    sens: 1, fov: 92, volume: 0.7, autoFire: false,
  });
  const settingsRef = useRef(settings);
  const pausedRef = useRef(false);
  const overRef = useRef(false);
  const startedRef = useRef(false);
  const keysRef = useRef<Set<string>>(new Set());
  const crouchRef = useRef(false);
  const hudWeaponRef = useRef<string>("ar");
  hudWeaponRef.current = hud?.weapon ?? "ar";

  settingsRef.current = settings;
  pausedRef.current = paused;
  overRef.current = !!over;
  startedRef.current = started;

  // --- score submission ----------------------------------------------------
  const handleGameOver = useCallback(
    (stats: GameOverStats) => {
      setOver(stats);
      setPaused(false);
      fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: playerName,
          score: stats.player.score,
          kills: stats.player.kills,
          deaths: stats.player.deaths,
          map: config.map,
        }),
      }).catch(() => {});
      try {
        const raw = localStorage.getItem("bs_local_scores");
        const list = raw ? JSON.parse(raw) : [];
        list.push({
          name: playerName,
          score: stats.player.score,
          kills: stats.player.kills,
          deaths: stats.player.deaths,
          date: Date.now(),
        });
        list.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
        localStorage.setItem("bs_local_scores", JSON.stringify(list.slice(0, 10)));
      } catch {}
      setSavedScore(true);
    },
    [config.map, playerName],
  );

  // --- start (click / tap) -------------------------------------------------
  const handleStart = useCallback(() => {
    if (!canvasRef.current || startedRef.current) return;
    startedRef.current = true;
    sfx.ensure();
    sfx.play("go");
    const eng = new GameEngine(canvasRef.current, config, playerName, {
      onHud: (s) => setHud(s),
      onGameOver: handleGameOver,
    });
    eng.applySettings(settingsRef.current);
    eng.start();
    setEngine(eng);
    setStarted(true);
    if (!isMobile) {
      canvasRef.current.requestPointerLock?.();
    }
  }, [config, playerName, isMobile, handleGameOver]);

  // --- destroy on unmount --------------------------------------------------
  useEffect(() => {
    return () => {
      engine?.destroy();
    };
  }, [engine]);

  // --- apply settings ------------------------------------------------------
  useEffect(() => {
    engine?.applySettings(settings);
  }, [engine, settings]);

  // --- pause helpers -------------------------------------------------------
  const doPause = useCallback(() => {
    if (overRef.current) return;
    const eng = engineRefReady();
    if (!eng) return;
    if (document.pointerLockElement) document.exitPointerLock?.();
    eng.setPaused(true);
    setPaused(true);
  }, []);

  const doResume = useCallback(() => {
    const eng = engineRefReady();
    if (!eng) return;
    eng.setPaused(false);
    setPaused(false);
    if (!isMobile && canvasRef.current) {
      canvasRef.current.requestPointerLock?.();
    }
  }, [isMobile]);

  const doRestart = useCallback(() => {
    const eng = engineRefReady();
    if (!eng) return;
    eng.restart();
    setOver(null);
    setPaused(false);
    setSavedScore(false);
    if (!isMobile) canvasRef.current?.requestPointerLock?.();
  }, [isMobile]);

  // engine accessor that always returns the live instance
  const engineRefInternal = useRef<GameEngine | null>(null);
  const engineRefReady = useCallback(() => engineRefInternal.current, []);
  useEffect(() => {
    engineRefInternal.current = engine;
  }, [engine]);

  // --- keyboard + mouse ----------------------------------------------------
  useEffect(() => {
    if (!engine) return;
    const eng = engine;
    const keys = keysRef.current;

    const updateMove = () => {
      const f = keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0;
      const b = keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0;
      const l = keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0;
      const r = keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0;
      eng.input.moveZ = f - b;
      eng.input.moveX = r - l;
      eng.input.sprintHeld = keys.has("ShiftLeft") || keys.has("ShiftRight");
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Tab") e.preventDefault();
      if (e.repeat) return;
      keys.add(e.code);
      if (!startedRef.current) return;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          eng.input.jumpPressed = true;
          break;
        case "KeyR":
          eng.input.reloadPressed = true;
          break;
        case "KeyC":
        case "KeyV":
          crouchRef.current = !crouchRef.current;
          eng.input.crouchHeld = crouchRef.current;
          break;
        case "Tab":
          setScoreboard(true);
          break;
        case "Escape":
          if (pausedRef.current) doResume();
          else doPause();
          break;
        case "KeyP":
          if (pausedRef.current) doResume();
          else doPause();
          break;
        case "KeyM":
          setSettings((s) => ({ ...s, volume: s.volume > 0 ? 0 : 0.7 }));
          break;
        default:
          if (e.code.startsWith("Digit")) {
            const n = Number(e.code.slice(5));
            if (n >= 1 && n <= WEAPON_ORDER.length) eng.input.switchWeapon = n - 1;
          }
      }
      updateMove();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
      if (e.code === "Tab") setScoreboard(false);
      updateMove();
    };
    const onBlur = () => {
      keys.clear();
      eng.input.moveX = 0;
      eng.input.moveZ = 0;
      eng.input.fire = false;
      eng.input.ads = false;
      if (startedRef.current && !pausedRef.current && !overRef.current) doPause();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement && startedRef.current && !pausedRef.current && !overRef.current) {
        eng.input.lookDX += e.movementX;
        eng.input.lookDY += e.movementY;
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!startedRef.current) return;
      if (document.pointerLockElement) {
        if (e.button === 0) eng.input.fire = true;
        if (e.button === 2) eng.input.ads = true;
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) eng.input.fire = false;
      if (e.button === 2) eng.input.ads = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (!startedRef.current || pausedRef.current) return;
      const cur = WEAPON_ORDER.indexOf((hudWeaponRef.current as typeof WEAPON_ORDER[number]) ?? "ar");
      const next = (cur + (e.deltaY > 0 ? 1 : WEAPON_ORDER.length - 1)) % WEAPON_ORDER.length;
      eng.input.switchWeapon = next;
    };
    const onLockChange = () => {
      if (!document.pointerLockElement && startedRef.current && !pausedRef.current && !overRef.current) {
        // small delay so Esc → resume clicks can re-lock
        window.setTimeout(() => {
          if (!document.pointerLockElement && startedRef.current && !pausedRef.current && !overRef.current) {
            doPause();
          }
        }, 400);
      }
    };
    const onContext = (e: Event) => e.preventDefault();
    const onCanvasClick = () => {
      if (startedRef.current && !isMobile && !document.pointerLockElement && !pausedRef.current && !overRef.current) {
        canvasRef.current?.requestPointerLock?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("contextmenu", onContext);
    canvasRef.current?.addEventListener("click", onCanvasClick);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("wheel", onWheel);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("contextmenu", onContext);
      canvasRef.current?.removeEventListener("click", onCanvasClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, doPause, doResume, isMobile]);

  // --- touch controls ------------------------------------------------------
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const stickState = useRef<{ id: number; ox: number; oy: number; active: boolean }>({ id: -1, ox: 0, oy: 0, active: false });
  const lookState = useRef<{ id: number; lx: number; ly: number }>({ id: -1, lx: 0, ly: 0 });

  const onStickDown = (e: React.PointerEvent) => {
    const eng = engineRefInternal.current;
    if (!eng) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    stickState.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY, active: true };
    if (stickRef.current) {
      const rect = stickRef.current.getBoundingClientRect();
      stickRef.current.style.left = `${e.clientX - rect.width / 2 - (stickRef.current.parentElement?.getBoundingClientRect().left ?? 0)}px`;
      stickRef.current.style.top = `${e.clientY - rect.height / 2 - (stickRef.current.parentElement?.getBoundingClientRect().top ?? 0)}px`;
      stickRef.current.style.opacity = "1";
    }
  };
  const onStickMove = (e: React.PointerEvent) => {
    const eng = engineRefInternal.current;
    if (!eng || stickState.current.id !== e.pointerId) return;
    e.preventDefault();
    const R = 52;
    let dx = e.clientX - stickState.current.ox;
    let dy = e.clientY - stickState.current.oy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    eng.input.moveX = dx / R;
    eng.input.moveZ = -dy / R;
  };
  const onStickUp = (e: React.PointerEvent) => {
    const eng = engineRefInternal.current;
    if (!eng || stickState.current.id !== e.pointerId) return;
    stickState.current.active = false;
    stickState.current.id = -1;
    eng.input.moveX = 0;
    eng.input.moveZ = 0;
    if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
    if (stickRef.current) stickRef.current.style.opacity = "0";
  };

  const onLookDown = (e: React.PointerEvent) => {
    if (!isMobile) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    lookState.current = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
  };
  const onLookMove = (e: React.PointerEvent) => {
    const eng = engineRefInternal.current;
    if (!eng || lookState.current.id !== e.pointerId) return;
    const k = 1.9;
    eng.input.lookDX += (e.clientX - lookState.current.lx) * k;
    eng.input.lookDY += (e.clientY - lookState.current.ly) * k;
    lookState.current.lx = e.clientX;
    lookState.current.ly = e.clientY;
  };
  const onLookUp = (e: React.PointerEvent) => {
    if (lookState.current.id === e.pointerId) lookState.current.id = -1;
  };

  const touchFireDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const eng = engineRefInternal.current;
    if (eng) eng.input.fire = true;
  };
  const touchFireUp = () => {
    const eng = engineRefInternal.current;
    if (eng) eng.input.fire = false;
  };
  const touchJump = (e: React.PointerEvent) => {
    e.preventDefault();
    const eng = engineRefInternal.current;
    if (eng) eng.input.jumpPressed = true;
  };
  const touchReload = (e: React.PointerEvent) => {
    e.preventDefault();
    const eng = engineRefInternal.current;
    if (eng) eng.input.reloadPressed = true;
  };
  const touchCrouch = (e: React.PointerEvent) => {
    e.preventDefault();
    const eng = engineRefInternal.current;
    if (eng) {
      crouchRef.current = !crouchRef.current;
      eng.input.crouchHeld = crouchRef.current;
    }
  };
  const touchWeapon = (e: React.PointerEvent, i: number) => {
    e.preventDefault();
    const eng = engineRefInternal.current;
    if (eng) eng.input.switchWeapon = i;
  };

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black" style={{ touchAction: "none" }}>
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>

      {/* touch look zone (mobile) */}
      {isMobile && started && (
        <div
          className="absolute inset-0 z-[15]"
          style={{ touchAction: "none" }}
          onPointerDown={onLookDown}
          onPointerMove={onLookMove}
          onPointerUp={onLookUp}
          onPointerCancel={onLookUp}
        />
      )}

      {hud && started && (
        <>
          <Crosshair hud={hud} />
          <Hitmarker hud={hud} />
          <DamageVignette hud={hud} />
          <KillFeed hud={hud} />
          <Announcement hud={hud} />
          <TopBar hud={hud} />
          <PlayerStats hud={hud} />
          <HealthAmmo hud={hud} />
          <ScopeOverlay hud={hud} />
          <FpsCounter hud={hud} />
          <Warmup hud={hud} />
          {hud.state === "playing" && hud.hp <= 0 && <DeathOverlay hud={hud} />}
        </>
      )}

      {/* scoreboard hold */}
      {scoreboard && hud && hud.state !== "ended" && <Scoreboard hud={hud} />}

      {/* mobile controls */}
      {isMobile && started && !over && (
        <>
          {/* move joystick zone */}
          <div
            className="absolute bottom-0 left-0 z-30 h-[52%] w-[45%]"
            style={{ touchAction: "none" }}
            onPointerDown={onStickDown}
            onPointerMove={onStickMove}
            onPointerUp={onStickUp}
            onPointerCancel={onStickUp}
          >
            <div
              ref={stickRef}
              className="pointer-events-none absolute h-28 w-28 rounded-full border-2 border-white/25 bg-white/5"
              style={{ left: 40, bottom: 90, opacity: 0, transition: "opacity 120ms" }}
            >
              <div
                ref={knobRef}
                className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/45 shadow-lg"
              />
            </div>
          </div>

          {/* right buttons */}
          <div className="absolute bottom-6 right-4 z-30 flex flex-col items-end gap-3" style={{ touchAction: "none" }}>
            <button
              className="hud-btn h-14 w-14 rounded-full border border-white/25 bg-white/10 text-lg"
              onPointerDown={touchJump}
              aria-label="Jump"
            >
              ⤒
            </button>
            <div className="flex items-end gap-3">
              <button className="hud-btn h-11 w-11 rounded-full border border-white/25 bg-white/10 text-[10px] font-black" onPointerDown={touchReload}>
                RLD
              </button>
              <button className="hud-btn h-11 w-11 rounded-full border border-white/25 bg-white/10 text-[10px] font-black" onPointerDown={touchCrouch}>
                CR
              </button>
              <button
                className="hud-btn h-20 w-20 rounded-full border-2 border-amber-400/70 bg-amber-400/25 text-xs font-black text-amber-300"
                onPointerDown={touchFireDown}
                onPointerUp={touchFireUp}
                onPointerCancel={touchFireUp}
                onPointerLeave={touchFireUp}
                aria-label="Fire"
              >
                FIRE
              </button>
            </div>
          </div>

          {/* weapon switch */}
          <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2">
            {WEAPON_ORDER.map((w, i) => (
              <button
                key={w}
                className={`hud-btn h-9 w-9 rounded border text-[9px] font-black ${
                  hud?.weapon === w ? "border-amber-400 bg-amber-400/30 text-amber-300" : "border-white/25 bg-white/10 text-white/70"
                }`}
                onPointerDown={(e) => touchWeapon(e, i)}
              >
                {i + 1}
              </button>
            ))}
          </div>

          {/* pause button */}
          <button
            className="hud-btn absolute right-3 top-3 z-40 h-10 w-10 rounded-lg border border-white/25 bg-black/50 text-sm font-black text-white"
            onPointerDown={(e) => { e.preventDefault(); doPause(); }}
            aria-label="Pause"
          >
            ❚❚
          </button>
        </>
      )}

      {/* desktop start overlay */}
      {!started && (
        <button onClick={handleStart} className="absolute inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-slate-950/85 backdrop-blur-sm">
          <div className="text-5xl font-black italic tracking-tight text-amber-400 sm:text-6xl" style={{ textShadow: "0 5px 0 rgba(0,0,0,0.6)" }}>
            BLOCKSHOT
          </div>
          <div className="mt-1 text-sm font-bold uppercase tracking-[0.5em] text-white/70">Arena</div>
          <div className="mt-10 rounded-xl border border-amber-400/60 bg-amber-400 px-10 py-4 text-lg font-black uppercase tracking-widest text-black shadow-[0_0_40px_rgba(251,191,36,0.35)] transition hover:bg-amber-300 active:scale-95">
            {isMobile ? "Tap to drop in" : "Click to drop in"}
          </div>
          <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-1 text-center text-xs font-bold text-white/60 sm:grid-cols-3">
            <span>WASD — Move</span>
            <span>Mouse — Aim</span>
            <span>Click — Fire</span>
            <span>Space — Jump</span>
            <span>Shift — Sprint</span>
            <span>C — Slide</span>
            <span>R — Reload</span>
            <span>1-4 — Weapons</span>
            <span>Tab — Scores</span>
          </div>
          <div className="mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Lobby {config.code} · {config.botCount + 1} players · {config.difficulty}
          </div>
        </button>
      )}

      {/* paused */}
      {paused && hud && (
        <PauseOverlay
          hud={hud}
          onResume={doResume}
          onRestart={doRestart}
          onQuit={onExit}
          settings={settings}
          onSettings={setSettings}
        />
      )}

      {/* game over */}
      {over && <GameOverOverlay stats={over} onRestart={doRestart} onQuit={onExit} saved={savedScore} />}
    </div>
  );
}
