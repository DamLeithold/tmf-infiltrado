"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import QRCode from "qrcode.react";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";
import { db, ensureAnonAuth } from "../../../lib/firebase";

type Game = {
  hostUid: string;
  status: "lobby" | "running" | "results";
  round?: number;
  createdAt?: any;
};

type Player = { id: string; name?: string; teamId?: string; joinedAt?: any; role?: "infiltrado" | "equipo" };

export default function LobbyPage() {
  const params = useParams();
  const code = String(params.code || "").toUpperCase();

  const [meUid, setMeUid] = useState<string | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("A");
  const [players, setPlayers] = useState<Player[]>([]);
  const [roleReveal, setRoleReveal] = useState<string>("");

  const joinUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/g/${code}`;
  }, [code]);

  const isHost = !!(meUid && game?.hostUid && meUid === game.hostUid);

  useEffect(() => {
    (async () => {
      const user = await ensureAnonAuth();
      setMeUid(user.uid);

      const unsubGame = onSnapshot(doc(db, "games", code), (snap) => {
        setGame(snap.exists() ? (snap.data() as any) : null);
      });

      const unsubPlayers = onSnapshot(collection(db, "games", code, "players"), (snap) => {
        setPlayers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      });

      return () => {
        unsubGame();
        unsubPlayers();
      };
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

  async function startRound() {
    if (!isHost) return;

    // Traer jugadores actuales
    const snap = await getDocs(collection(db, "games", code, "players"));
    const list: Player[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    if (list.length < 5) {
      return alert("Mínimo 5 jugadores para arrancar.");
    }

    // Elegir infiltrado al azar (1 total)
    const idx = Math.floor(Math.random() * list.length);
    const infiltradoId = list[idx].id;

    // Guardar roles en players (simple para MVP)
    await Promise.all(
      list.map((p) =>
        updateDoc(doc(db, "games", code, "players", p.id), {
          role: p.id === infiltradoId ? "infiltrado" : "equipo",
        })
      )
    );

    // Actualizar estado del juego
    await updateDoc(doc(db, "games", code), {
      status: "running",
      round: (game?.round || 0) + 1,
      startedAt: serverTimestamp(),
    });

    alert("Ronda iniciada ✅");
  }

  async function revealMyRole() {
    if (!meUid) return;
    const me = players.find((p) => p.id === meUid);
    if (!me?.role) {
      setRoleReveal("Todavía no empezó la ronda o no tenés rol asignado.");
      return;
    }
    setRoleReveal(me.role === "infiltrado" ? "🕵️ SOS EL INFILTRADO" : "✅ SOS DEL EQUIPO");
  }

  return (
    <main style={{ padding: 20, display: "grid", gap: 14, fontFamily: "Arial" }}>
      <h2>
        Lobby — Código: {code} {game?.status ? `(${game.status})` : ""}
      </h2>

      <div style={{ display: "grid", gap: 8, maxWidth: 360 }}>
        <strong>QR para unirse:</strong>
        {joinUrl ? <QRCode value={joinUrl} /> : null}
        <small style={{ wordBreak: "break-all" }}>{joinUrl}</small>
      </div>

      {isHost ? (
        <section style={{ display: "grid", gap: 8, maxWidth: 420, padding: 12, border: "1px solid #ddd" }}>
          <h3>Panel Host</h3>
          <button
            onClick={startRound}
            style={{
              padding: 10,
              fontSize: 16,
              backgroundColor: "#dc2626",
              color: "white",
              border: "none",
              borderRadius: 5,
            }}
          >
            Iniciar ronda
          </button>
          <small>Asigna 1 infiltrado al azar y cambia el estado a running.</small>
        </section>
      ) : null}

      <section style={{ display: "grid", gap: 8, maxWidth: 420 }}>
        <h3>Unirme</h3>
        <input
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 10, fontSize: 16 }}
        />
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ padding: 10, fontSize: 16 }}>
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

        <button
          onClick={revealMyRole}
          style={{
            padding: 10,
            fontSize: 16,
            backgroundColor: "#111827",
            color: "white",
            border: "none",
            borderRadius: 5,
          }}
        >
          Ver mi rol
        </button>

        {roleReveal ? <div style={{ padding: 10, border: "1px solid #ddd" }}>{roleReveal}</div> : null}
      </section>

      <section>
        <h3>Jugadores ({players.length})</h3>
        <ul>
          {players.map((p) => (
            <li key={p.id}>
              {p.name || "(sin nombre)"} — Equipo {p.teamId || "?"}
              {isHost && p.role ? ` — rol: ${p.role}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
