"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Menu from "@/components/Menu";
import { LobbyConfig } from "@/lib/game/config";

// GameClient touches window/WebGL — load it client-side only.
const GameClient = dynamic(() => import("@/components/GameClient"), { ssr: false });

interface Session {
  cfg: LobbyConfig;
  name: string;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);

  if (session) {
    return (
      <GameClient
        config={session.cfg}
        playerName={session.name}
        onExit={() => setSession(null)}
      />
    );
  }
  return <Menu onJoin={(cfg, name) => setSession({ cfg, name })} />;
}
