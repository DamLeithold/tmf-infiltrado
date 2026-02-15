"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import QRCode from "qrcode.react";
import { collection, doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db, ensureAnonAuth } from "../../../lib/firebase";

type Player = { id: string; name?: string; teamId?: string };

export default function LobbyPage() {
  const params = useParams();
  const code = String(params.code || "").toUpperCase();

  const [meUid, setMeUid] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("A");
  const [players, setPlayers] = useState<Player[]>([]);

  const joinUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/g/${code}`;
  }, [code]);

  useEffect(() => {
    (async () => {
      const user = await ensureAnonAuth();
      setMeUid(user.uid);

      const unsubPlayers = onSnapshot(collection(db, "games", code, "players"), (snap) => {
        setPlayers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      });

      return () => unsubPlayers();
    })();
  }, [code]);

  async function joinGame() {
    if (!meUid) return;
    if (!name.trim()) return alert("Poné tu nombre");

    await setDoc(doc(db, "games", code, "players", meUid), {
      name: name.trim(),
      teamId,
      joinedAt: serverTimestamp(),
    });

    alert("Listo ✅ Ya estás en la partida");
  }

  return (
    <main style={{ padding: 20, display: "grid", gap: 14, fontFamily: "Arial" }}>
      <h2>Lobby — Código: {code}</h2>

      <div style={{ display: "grid", gap: 8, maxWidth: 360 }}>
        <strong>QR para unirse:</strong>
        {joinUrl ? <QRCode value={joinUrl} /> : null}
        <small style={{ wordBreak: "break-all" }}>{joinUrl}</small>
      </div>

      <section style={{ display: "grid", gap: 8, maxWidth: 420 }}>
        <h3>Unirme</h3>
        <input
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 10, fontSize: 16 }}
        />
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          style={{ padding: 10, fontSize: 16 }}
        >
          <option value="A">Equipo A</option>
          <option value="B">Equipo B</option>
          <option value="C">Equipo C</option>
        </select>

        <button
          onClick={joinGame}
          style={{
            padding: 10,
            fontSize: 16,
            backgroundColor: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 5,
          }}
        >
          Entrar a la partida
        </button>
      </section>

      <section>
        <h3>Jugadores ({players.length})</h3>
        <ul>
          {players.map((p) => (
            <li key={p.id}>
              {p.name || "(sin nombre)"} — Equipo {p.teamId || "?"}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
