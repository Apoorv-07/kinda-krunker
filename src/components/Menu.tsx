"use client";

// ---------------------------------------------------------------------------
// Main menu: quick play, custom lobby creation, lobby browser, global + local
// leaderboards, and a how-to-play panel. All lobby data lives in PostgreSQL.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Difficulty, LobbyConfig, MapId } from "@/lib/game/config";
import { stackLabel } from "@/lib/net/protocol";

interface MenuProps {
  onJoin: (cfg: LobbyConfig, playerName: string, stackId?: string) => void;
}

interface ApiLobby {
  code: string;
  name: string;
  hostName: string;
  map: string;
  seed: number;
  botCount: number;
  botFill?: number;
  teamMode?: "ffa" | "teams";
  stackSize?: number;
  status?: string;
  difficulty: string;
  scoreLimit: number;
  timeLimit: number;
  createdAt: string;
}

interface ApiScore {
  name: string;
  score: number;
  kills: number;
  deaths: number;
  map: string;
}

const MAPS: Array<{ id: MapId | "random"; label: string; desc: string }> = [
  { id: "random", label: "Random", desc: "Surprise me" },
  { id: "yard", label: "Crates Yard", desc: "Bright desert yard" },
  { id: "neon", label: "Neon Grid", desc: "Cyber night arena" },
  { id: "dusk", label: "Dusk Towers", desc: "Sunset rooftops" },
];

const DIFFS: Array<{ id: Difficulty; label: string }> = [
  { id: "easy", label: "Easy" },
  { id: "normal", label: "Normal" },
  { id: "hard", label: "Hard" },
];

function normalizeLobby(row: ApiLobby): LobbyConfig {
  const maps: MapId[] = ["yard", "neon", "dusk"];
  const map: MapId = row.map === "random" ? maps[Math.abs(row.seed) % 3] : (row.map as MapId);
  return {
    code: row.code,
    name: row.name,
    hostName: row.hostName,
    map,
    seed: row.seed,
    botCount: row.botFill ?? row.botCount ?? 5,
    difficulty: (row.difficulty as Difficulty) ?? "normal",
    scoreLimit: row.scoreLimit,
    timeLimit: row.timeLimit,
    teamMode: (row.teamMode as "ffa" | "teams") ?? "ffa",
    stackSize: row.stackSize ?? 5,
  };
}

export default function Menu({ onJoin }: MenuProps) {
  const [tab, setTab] = useState<"play" | "party" | "custom" | "browse" | "scores" | "how">("play");
  const [name, setName] = useState<string>("");
  const [activeCount, setActiveCount] = useState<number>(0);
  const [lobbies, setLobbies] = useState<ApiLobby[]>([]);
  const [scores, setScores] = useState<ApiScore[]>([]);
  const [localScores, setLocalScores] = useState<Array<{ name: string; score: number; kills: number; deaths: number; date: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);

  // custom form
  const [lobbyName, setLobbyName] = useState("");
  const [mapSel, setMapSel] = useState<MapId | "random">("random");
  const [bots, setBots] = useState(5);
  const [diff, setDiff] = useState<Difficulty>("normal");
  const [scoreLimit, setScoreLimit] = useState(25);
  const [timeLimit, setTimeLimit] = useState(300);
  // party + team options
  const [teamMode, setTeamMode] = useState<"ffa" | "teams">("teams");
  const [stackSize, setStackSize] = useState(5);
  const [partyCode, setPartyCode] = useState("");
  const [partyStackId, setPartyStackId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [partyMsg, setPartyMsg] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("bs_name");
    if (saved) setName(saved);
    else {
      const n = "Player" + Math.floor(Math.random() * 1000);
      setName(n);
      localStorage.setItem("bs_name", n);
    }
    try {
      const raw = localStorage.getItem("bs_local_scores");
      if (raw) setLocalScores(JSON.parse(raw));
    } catch {}
    void refreshBrowse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveName = (v: string) => {
    setName(v);
    localStorage.setItem("bs_name", v);
  };

  // Builds a playable arena entirely on the client. Used as a fallback when the
  // leaderboard/lobby API is unreachable, so the core loop is never blocked.
  const offlineLobby = useCallback(
    (partial: { name: string; map: MapId | "random"; botCount: number; difficulty: Difficulty; scoreLimit: number; timeLimit: number }) => {
      const maps: MapId[] = ["yard", "neon", "dusk"];
      const seed = Math.floor(Math.random() * 1_000_000_000);
      const map: MapId = partial.map === "random" ? maps[Math.abs(seed) % 3] : partial.map;
      const code = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
      const cfg: LobbyConfig = {
        code,
        name: partial.name,
        hostName: name || "Player",
        map,
        seed,
        botCount: partial.botCount,
        difficulty: partial.difficulty,
        scoreLimit: partial.scoreLimit,
        timeLimit: partial.timeLimit,
      };
      setOffline(true);
      onJoin(cfg, name || "Player", partyStackId ?? undefined);
    },
    [name, onJoin],
  );

  const createLobby = useCallback(
    async (body: Record<string, unknown>, allowOfflineFallback = false) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/lobbies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          hostName: name || "Player", ...body,
          teamMode: teamMode,
          stackSize: stackSize,
          stackId: partyStackId ?? undefined,
        }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create lobby");
        onJoin(normalizeLobby(data.lobby), name || "Player", partyStackId ?? undefined);
      } catch (e) {
        // The match itself needs no database — fall back so play is never blocked.
        if (allowOfflineFallback) {
          offlineLobby({
            name: String(body.name ?? "Offline Arena").slice(0, 32),
            map: (body.map as MapId | "random") ?? "random",
            botCount: Number(body.botCount ?? 5),
            difficulty: (body.difficulty as Difficulty) ?? "normal",
            scoreLimit: Number(body.scoreLimit ?? 25),
            timeLimit: Number(body.timeLimit ?? 300),
          });
          return;
        }
        setError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    },
    [name, onJoin, offlineLobby],
  );

  const quickPlay = () => {
    const names = ["Quick Drop", "Rumble Pit", "Night Ops", "Crate Chaos", "No Scope Lounge", "Turbo Arena", "Block Party", "Frag Fest"];
    void createLobby(
      {
        name: names[Math.floor(Math.random() * names.length)],
        map: "random",
        botCount: 5,
        difficulty: "normal",
        scoreLimit: 25,
        timeLimit: 300,
      },
      true,
    );
  };

  const joinLobby = async (code: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/lobbies/${code}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lobby not found");
      onJoin(normalizeLobby(data.lobby), name || "Player", partyStackId ?? undefined);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const refreshBrowse = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/lobbies");
      const data = await res.json();
      setLobbies(data.lobbies ?? []);
      setActiveCount(data.activeCount ?? data.lobbies?.length ?? 0);
    } catch {
      setLobbies([]);
    } finally {
      setLoading(false);
    }
  };

  const refreshScores = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scores");
      const data = await res.json();
      setScores(data.scores ?? []);
    } catch {
      setScores([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "browse") void refreshBrowse();
    if (tab === "scores") void refreshScores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const timeAgo = (iso: string) => {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  };

  const tabs: Array<{ id: typeof tab; label: string }> = [
    { id: "play", label: "Quick Play" },
    { id: "party", label: "Play with Friends" },
    { id: "custom", label: "Create Lobby" },
    { id: "browse", label: "Lobby List" },
    { id: "scores", label: "Leaderboard" },
    { id: "how", label: "How to Play" },
  ];

  return (
    <div className="menu-bg relative min-h-screen w-full overflow-x-hidden bg-[#070a12] text-white">
      {/* floating cubes backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="menu-grid" />
        {Array.from({ length: 14 }).map((_, i) => (
          <span
            key={i}
            className="menu-cube"
            style={{
              left: `${(i * 67) % 100}%`,
              animationDelay: `${(i * 1.3) % 9}s`,
              animationDuration: `${10 + (i % 5) * 3}s`,
              width: `${12 + (i % 4) * 8}px`,
              height: `${12 + (i % 4) * 8}px`,
              opacity: 0.1 + (i % 3) * 0.06,
              background: i % 3 === 0 ? "#f59e0b" : i % 3 === 1 ? "#22d3ee" : "#f472b6",
            }}
          />
        ))}
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 sm:py-10">
        {/* header */}
        <header className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="text-center sm:text-left">
            <h1 className="text-4xl font-black italic tracking-tight text-amber-400 sm:text-5xl" style={{ textShadow: "0 4px 0 rgba(0,0,0,0.55)" }}>
              BLOCKSHOT
            </h1>
            <p className="text-[11px] font-bold uppercase tracking-[0.55em] text-white/60">Arena · Fast Blocky FPS</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-xs font-bold text-white/70">{activeCount} lobb{activeCount === 1 ? "y" : "ies"} recent</span>
            </div>
            {offline && (
              <div className="rounded-full border border-amber-400/40 bg-amber-400/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-300">
                Offline arena
              </div>
            )}
            <input
              value={name}
              onChange={(e) => saveName(e.target.value.slice(0, 16))}
              placeholder="Your name"
              className="w-36 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-bold text-white outline-none placeholder:text-white/35 focus:border-amber-400/70"
            />
          </div>
        </header>

        {/* tabs */}
        <nav className="mt-6 flex flex-wrap gap-1.5 rounded-xl border border-white/10 bg-black/40 p-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider transition sm:text-sm ${
                tab === t.id ? "bg-amber-400 text-black shadow-[0_0_18px_rgba(251,191,36,0.35)]" : "text-white/65 hover:bg-white/10 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <main className="mt-5 flex-1">
          {error && <div className="mb-3 rounded-lg border border-red-500/50 bg-red-500/15 px-3 py-2 text-sm font-bold text-red-300">{error}</div>}

          {tab === "play" && (
            <div className="flex flex-col items-center gap-6 py-8">
              <p className="max-w-md text-center text-sm leading-relaxed text-white/60">
                Drop straight into a unique arena with real generated geometry, intelligent bots,
                and instant respawns. First to the kill target wins.
              </p>
              <button
                onClick={quickPlay}
                disabled={loading || !name.trim()}
                className="menu-btn-primary group relative overflow-hidden rounded-2xl px-12 py-5 text-xl font-black uppercase tracking-widest text-black transition active:scale-95 disabled:opacity-50"
              >
                {loading ? "Dropping in…" : "▶ Play Now"}
              </button>
              <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                {[
                  ["3", "Arenas"],
                  ["4", "Weapons"],
                  ["7", "Bots max"],
                  ["60", "FPS target"],
                ].map(([n, l]) => (
                  <div key={l} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="text-2xl font-black text-amber-300">{n}</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "party" && (
            <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
              {/* stack size */}
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-amber-300">Your stack</h2>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-white/45">
                  How many of you are playing together
                </p>
                <div className="mt-3 grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => { setStackSize(n); if (n === 1) setPartyStackId(null); }}
                      className={`rounded-lg border px-1 py-3 text-center transition ${
                        stackSize === n ? "border-amber-400 bg-amber-400/15" : "border-white/15 bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <div className="text-lg font-black text-white">{n}</div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-white/50">{stackLabel(n)}</div>
                    </button>
                  ))}
                </div>

                <h2 className="mt-5 text-xs font-black uppercase tracking-[0.3em] text-amber-300">Mode</h2>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {([
                    { id: "teams", label: "Teams", desc: "Your stack vs the others" },
                    { id: "ffa", label: "Free-for-all", desc: "Everyone vs everyone" },
                  ] as const).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setTeamMode(m.id)}
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        teamMode === m.id ? "border-amber-400 bg-amber-400/15" : "border-white/15 bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <div className="text-xs font-black text-white">{m.label}</div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-white/45">{m.desc}</div>
                    </button>
                  ))}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/60">Bots</label>
                    <input type="range" min={0} max={7} step={1} value={bots} onChange={(e) => setBots(Number(e.target.value))} className="w-full accent-amber-400" />
                    <div className="text-center text-[10px] font-bold text-amber-300">{bots}</div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/60">Kill target</label>
                    <div className="flex gap-1.5">
                      {[15, 25, 40].map((sc) => (
                        <button key={sc} onClick={() => setScoreLimit(sc)}
                          className={`flex-1 rounded-lg border px-1 py-2 text-xs font-black transition ${
                            scoreLimit === sc ? "border-amber-400 bg-amber-400/15 text-amber-300" : "border-white/15 bg-white/5 text-white/70"
                          }`}>{sc}</button>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() =>
                    void createLobby({
                      name: `${(name || "Player").trim()}\'s ${stackLabel(stackSize)} Match`,
                      map: mapSel, teamMode, stackSize, botFill: bots,
                      difficulty: diff, scoreLimit, timeLimit,
                      stackId: partyStackId ?? undefined,
                    }, true)
                  }
                  disabled={loading || !name.trim()}
                  className="menu-btn-primary mt-5 w-full rounded-xl px-6 py-3.5 text-sm font-black uppercase tracking-widest text-black transition active:scale-95 disabled:opacity-50"
                >
                  {loading ? "Creating…" : stackSize === 1 ? "▶ Start Solo Match" : `▶ Create ${stackLabel(stackSize)} Match`}
                </button>
                {stackSize > 1 && !partyStackId && (
                  <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-wide text-amber-300/80">
                    Create a party code below and share it so your friends spawn on your team
                  </p>
                )}
              </div>

              {/* party code */}
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Party code</h2>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-white/45">
                  Friends enter this to join your stack
                </p>

                {partyStackId ? (
                  <div className="mt-4">
                    <div className="rounded-xl border-2 border-dashed border-cyan-400/60 bg-cyan-400/10 px-4 py-5 text-center">
                      <div className="font-mono text-3xl font-black tracking-[0.3em] text-cyan-300">{partyCode}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/50">share this code</div>
                    </div>
                    <button
                      onClick={() => {
                        void navigator.clipboard?.writeText(partyCode);
                        setPartyMsg("Copied!");
                        window.setTimeout(() => setPartyMsg(""), 1500);
                      }}
                      className="mt-3 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-white/20 active:scale-95"
                    >
                      Copy code
                    </button>
                    <button
                      onClick={() => { setPartyStackId(null); setPartyCode(""); setPartyMsg("Left the party"); }}
                      className="mt-2 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-wider text-white/70 transition hover:bg-white/10"
                    >
                      Leave party
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      setLoading(true); setPartyMsg("");
                      try {
                        const res = await fetch("/api/parties", {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "create", leaderName: name || "Player" }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || "Could not create party");
                        setPartyCode(data.party.code);
                        setPartyStackId(data.party.stackId);
                        setPartyMsg("Party created — share the code!");
                      } catch (e) {
                        setPartyMsg(friendlyError(e));
                      } finally { setLoading(false); }
                    }}
                    disabled={loading || !name.trim()}
                    className="mt-4 w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black uppercase tracking-widest text-black transition hover:bg-cyan-300 active:scale-95 disabled:opacity-50"
                  >
                    + Create party
                  </button>
                )}

                <div className="mt-6 border-t border-white/10 pt-5">
                  <h3 className="text-xs font-black uppercase tracking-[0.3em] text-white/70">Join a friend</h3>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 5))}
                      placeholder="CODE"
                      className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-center font-mono text-lg font-black tracking-[0.25em] outline-none placeholder:text-white/30 focus:border-cyan-400/70"
                    />
                    <button
                      onClick={async () => {
                        if (!joinCode.trim()) return;
                        setLoading(true); setPartyMsg("");
                        try {
                          const res = await fetch("/api/parties", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "join", code: joinCode }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || "Party not found");
                          setPartyCode(data.party.code);
                          setPartyStackId(data.party.stackId);
                          setStackSize(Math.max(stackSize, 2));
                          setPartyMsg(`Joined ${data.party.leaderName}\'s party!`);
                        } catch (e) {
                          setPartyMsg(friendlyError(e));
                        } finally { setLoading(false); }
                      }}
                      disabled={loading || joinCode.length < 4}
                      className="shrink-0 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-black uppercase tracking-wider text-black transition hover:bg-cyan-300 active:scale-95 disabled:opacity-50"
                    >
                      Join
                    </button>
                  </div>
                </div>

                {partyMsg && (
                  <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-bold text-white/75">
                    {partyMsg}
                  </div>
                )}

                <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-white/50">How it works</div>
                  <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-white/60">
                    <li>• Create a match, then send friends the <b className="text-amber-300">lobby code</b> from the waiting room.</li>
                    <li>• In <b>Teams</b> mode everyone with your party code spawns on your side.</li>
                    <li>• Bots fill empty slots, so a match is never waiting on people.</li>
                    <li>• If the host leaves, the next player takes over the match automatically.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {tab === "custom" && (
            <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-black/40 p-5 sm:p-6">
              <h2 className="text-sm font-black uppercase tracking-[0.3em] text-amber-300">Create your lobby</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/60">Lobby name</label>
                  <input
                    value={lobbyName}
                    onChange={(e) => setLobbyName(e.target.value.slice(0, 32))}
                    placeholder="My arena"
                    className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold outline-none placeholder:text-white/35 focus:border-amber-400/70"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/60">Map</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {MAPS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setMapSel(m.id)}
                        className={`rounded-lg border px-2 py-2 text-left transition ${
                          mapSel === m.id ? "border-amber-400 bg-amber-400/15" : "border-white/15 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <div className="text-xs font-black text-white">{m.label}</div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-white/45">{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-white/60">
                    Opponents: <span className="text-amber-300">{bots} bots</span>
                  </label>
                  <input type="range" min={1} max={7} step={1} value={bots} onChange={(e) => setBots(Number(e.target.value))} className="w-full accent-amber-400" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/60">Difficulty</label>
                  <div className="grid grid-cols-3 gap-2">
                    {DIFFS.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setDiff(d.id)}
                        className={`rounded-lg border px-2 py-2 text-xs font-black uppercase tracking-wider transition ${
                          diff === d.id ? "border-amber-400 bg-amber-400/15 text-amber-300" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/60">Kill target</label>
                    <div className="flex gap-1.5">
                      {[15, 25, 40].map((s) => (
                        <button
                          key={s}
                          onClick={() => setScoreLimit(s)}
                          className={`flex-1 rounded-lg border px-2 py-2 text-xs font-black transition ${
                            scoreLimit === s ? "border-amber-400 bg-amber-400/15 text-amber-300" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/60">Time limit</label>
                    <div className="flex gap-1.5">
                      {[120, 300, 600].map((s) => (
                        <button
                          key={s}
                          onClick={() => setTimeLimit(s)}
                          className={`flex-1 rounded-lg border px-2 py-2 text-xs font-black transition ${
                            timeLimit === s ? "border-amber-400 bg-amber-400/15 text-amber-300" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
                          }`}
                        >
                          {s / 60}m
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() =>
                    void createLobby({
                      name: lobbyName.trim() || `${name.trim() || "Player"}'s Arena`,
                      map: mapSel,
                      botCount: bots,
                      difficulty: diff,
                      scoreLimit,
                      timeLimit,
                    }, true)
                  }
                  disabled={loading || !name.trim()}
                  className="menu-btn-primary w-full rounded-xl px-6 py-3.5 text-sm font-black uppercase tracking-widest text-black transition active:scale-95 disabled:opacity-50"
                >
                  {loading ? "Creating…" : "Create & Drop In"}
                </button>
              </div>
            </div>
          )}

          {tab === "browse" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-[0.3em] text-white/70">Active lobbies</h2>
                <button onClick={() => void refreshBrowse()} className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white/80 transition hover:bg-white/20 active:scale-95">
                  Refresh
                </button>
              </div>
              {lobbies.length === 0 && !loading && (
                <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-sm text-white/50">
                  No lobbies yet — create one and it will show up here for everyone.
                </div>
              )}
              <div className="grid gap-2.5 sm:grid-cols-2">
                {lobbies.map((l) => (
                  <div key={l.code} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 p-3.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-white">{l.name}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] font-bold uppercase tracking-wide text-white/50">
                        <span className="text-amber-300/80">#{l.code}</span>
                        <span>{l.map === "random" ? "random map" : l.map}</span>
                        <span>{l.botCount + 1}P</span>
                        <span>{l.difficulty}</span>
                        <span>{l.scoreLimit > 0 ? `first to ${l.scoreLimit}` : `${l.timeLimit / 60}m`}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-white/35">by {l.hostName} · {timeAgo(l.createdAt)}</div>
                    </div>
                    <button
                      onClick={() => void joinLobby(l.code)}
                      disabled={loading}
                      className="shrink-0 rounded-lg bg-amber-400 px-4 py-2 text-xs font-black uppercase tracking-wider text-black transition hover:bg-amber-300 active:scale-95 disabled:opacity-50"
                    >
                      Join
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "scores" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xs font-black uppercase tracking-[0.3em] text-amber-300">Global top 10</h2>
                  <button onClick={() => void refreshScores()} className="text-[10px] font-bold uppercase tracking-wider text-white/50 hover:text-white">
                    reload
                  </button>
                </div>
                <ScoreTable rows={scores.map((s) => ({ name: s.name, score: s.score, sub: `${s.kills}K / ${s.deaths}D · ${s.map}` }))} empty="No global scores yet — be the first!" />
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <h2 className="mb-2 text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Your local best</h2>
                <ScoreTable rows={localScores.map((s) => ({ name: s.name, score: s.score, sub: `${s.kills}K / ${s.deaths}D` }))} empty="Play a match to set a record." />
              </div>
            </div>
          )}

          {tab === "how" && (
            <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-amber-300">Desktop controls</h2>
                <ul className="mt-3 space-y-1.5 text-sm text-white/70">
                  <li><Key>WASD</Key> move · <Key>Mouse</Key> look</li>
                  <li><Key>Click</Key> fire · <Key>Right-click</Key> aim down sights</li>
                  <li><Key>Space</Key> jump · <Key>Shift</Key> sprint</li>
                  <li><Key>C</Key> crouch / slide while sprinting</li>
                  <li><Key>R</Key> reload · <Key>1–4</Key> or <Key>Wheel</Key> weapons</li>
                  <li><Key>Tab</Key> scoreboard · <Key>Esc</Key> pause</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Touch controls</h2>
                <ul className="mt-3 space-y-1.5 text-sm text-white/70">
                  <li>◉ Left side: virtual stick to move</li>
                  <li>◉ Right side: drag to look around</li>
                  <li>◉ FIRE button to shoot · JUMP / RLD / CR buttons</li>
                  <li>◉ Weapon chips on the right edge</li>
                  <li>◉ Pause button top-right, enable auto-fire in settings</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5 md:col-span-2">
                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-fuchsia-300">Rules & tips</h2>
                <ul className="mt-3 grid gap-1.5 text-sm text-white/70 sm:grid-cols-2">
                  <li>• First player to the kill target wins (or highest score when time runs out).</li>
                  <li>• Health regenerates 3s after taking damage.</li>
                  <li>• Glowing pads launch you onto towers and rooftops.</li>
                  <li>• Floating weapon crates unlock SMG, shotgun and railgun.</li>
                  <li>• Headshots deal double damage — aim high.</li>
                  <li>• Sliding (C while sprinting) makes you harder to hit.</li>
                </ul>
              </div>
            </div>
          )}
        </main>

        <footer className="mt-6 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-white/30">
          Blockshot Arena · create a lobby · share the code · dominate
        </footer>
      </div>
    </div>
  );
}

/** Turn raw server errors into something a player can act on. */
function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const s = raw.toLowerCase();
  if (s.includes("database_url") || s.includes("no database connection") || s.includes("connection string")) {
    return "Database not connected. Set DATABASE_URL in Vercel → Settings → Environment Variables, then REDEPLOY (new env vars never affect an existing deployment). Quick Play still works offline.";
  }
  if (s.includes("does not exist") || s.includes("relation")) {
    return "Database connected, but the tables are missing. Run schema.sql in your database's SQL editor once.";
  }
  if (s.includes("password authentication") || s.includes("role") || s.includes("permission")) {
    return "Database rejected the credentials. Check that DATABASE_URL is the current connection string for this database.";
  }
  if (s.includes("fetch") || s.includes("network") || s.includes("failed to fetch")) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return raw.replace(/^Error:\s*/i, "").slice(0, 220);
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[11px] font-black text-white">
      {children}
    </span>
  );
}

function ScoreTable({ rows, empty }: { rows: Array<{ name: string; score: number; sub: string }>; empty: string }) {
  if (rows.length === 0) {
    return <div className="rounded-lg border border-dashed border-white/15 bg-white/5 p-6 text-center text-xs text-white/45">{empty}</div>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-2 border-b border-white/5 bg-white/[0.03] px-3 py-2 last:border-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={`w-6 shrink-0 text-center font-mono text-sm font-black ${i === 0 ? "text-amber-400" : i === 1 ? "text-slate-300" : i === 2 ? "text-amber-700" : "text-white/40"}`}>
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-white">{r.name}</div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">{r.sub}</div>
            </div>
          </div>
          <span className="shrink-0 font-mono text-sm font-black text-amber-300">{r.score}</span>
        </div>
      ))}
    </div>
  );
}
