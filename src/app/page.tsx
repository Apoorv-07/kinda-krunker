"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Menu from "@/components/Menu";
import { LobbyConfig } from "@/lib/game/config";
import { getLocalStackId, getPlayerId } from "@/lib/net/client";

// GameClient touches window/WebGL — load it client-side only.
const GameClient = dynamic(() => import("@/components/GameClient"), { ssr: false });

interface Session {
  cfg: LobbyConfig;
  name: string;
  stackId?: string;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);

  if (session) {
    // A lobby that another player created (or a party match) is networked;
    // Quick Play / offline arenas stay purely local.
    const isShared = Boolean(session.cfg.hostPlayerId || session.stackId);
    return (
      <GameClient
        config={session.cfg}
        playerName={session.name}
        onExit={() => setSession(null)}
        net={
          isShared
            ? {
                playerId: getPlayerId(),
                stackId: session.stackId ?? getLocalStackId(),
                teamMode: session.cfg.teamMode ?? "ffa",
                myTeam: 0,
              }
            : undefined
        }
      />
    );
  }
  return <Menu onJoin={(cfg, name, stackId) => setSession({ cfg, name, stackId })} />;
}
