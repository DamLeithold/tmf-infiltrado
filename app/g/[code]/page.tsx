"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type Player = {
  nombre: string;
  equipo: "A" | "B" | "C" | "D";
  rol?: "equipo" | "infiltrado";
};

type GameDoc = {
  code: string;
  estado: "lobby" | "running";
  ronda: number;
  players: Player[];
  roundEndsAt?: number;
};

const EQUIPOS = ["A", "B", "C", "D"] as const;

const ROUND_DURATION = 300; // segundos

export default function Lobby({ params }: { params: { code: string } }) {
  
  const code = params.code;

  const [game, setGame] = useState<GameDoc | null>(null);

  const [showRole, setShowRole] = useState(false);

  const [now, setNow] = useState(Date.now());

  const nombre =
    typeof window !== "undefined"
      ? localStorage.getItem("nombre") || ""
      : "";

  useEffect(() => {

    const ref = doc(db, "games", code);

    return onSnapshot(ref, snap => {

      const data = snap.data() as GameDoc;

      setGame(data);

    });

  }, []);

  useEffect(() => {

    const interval = setInterval(() => {

      setNow(Date.now());

    }, 500);

    return () => clearInterval(interval);

  }, []);

  const miJugador = useMemo(() => {

    if (!game) return null;

    return game.players?.find(p =>
      p.nombre === nombre
    );

  }, [game, nombre]);

  const tiempoRestante = useMemo(() => {

    if (!game?.roundEndsAt) return 0;

    const ms = game.roundEndsAt - now;

    return Math.max(0, Math.floor(ms / 1000));

  }, [game?.roundEndsAt, now]);

  const minutos = Math.floor(tiempoRestante / 60)
    .toString()
    .padStart(2, "0");

  const segundos = (tiempoRestante % 60)
    .toString()
    .padStart(2, "0");

  async function iniciarRonda() {

    if (!game) return;

    const nuevos = game.players.map(p => ({
      ...p,
      rol: "equipo"
    }));

    EQUIPOS.forEach(eq => {

      const jugadoresEquipo =
        nuevos.filter(p =>
          p.equipo === eq
        );

      if (jugadoresEquipo.length > 0) {

        const infiltrado =
          jugadoresEquipo[
            Math.floor(
              Math.random() *
                jugadoresEquipo.length
            )
          ];

        infiltrado.rol = "infiltrado";

      }

    });

    const roundEndsAt =
      Date.now() +
      ROUND_DURATION * 1000;

    await updateDoc(
      doc(db, "games", code),
      {
        players: nuevos,
        estado: "running",
        ronda: (game.ronda || 0) + 1,
        roundEndsAt
      }
    );

  }

  async function pantallaCompleta() {

    const elem =
      document.documentElement;

    if (!document.fullscreenElement)
      await elem.requestFullscreen();
    else await document.exitFullscreen();

  }

  if (!game)
    return (
      <div style={{ padding: 20 }}>
        Cargando...
      </div>
    );

  return (
    <div style={{ padding: 20 }}>

      <img
        src="/TMF_Group.png"
        style={{
          width: 120,
          marginBottom: 20
        }}
      />

      <h2>
        Código: {code}
      </h2>

      <h3>
        Estado: {game.estado}
      </h3>

      <h3>
        Ronda: {game.ronda || 0}
      </h3>

      {game.estado === "running" && (
        <h2>
          ⏱ {minutos}:{segundos}
        </h2>
      )}

      <button
        onClick={pantallaCompleta}
        style={{
          padding: 10,
          marginRight: 10
        }}
      >
        Pantalla completa
      </button>

      <button
        onClick={iniciarRonda}
        style={{
          background: "red",
          color: "white",
          padding: 10,
          border: "none"
        }}
      >
        Iniciar / Siguiente ronda
      </button>

      <hr />

      <button
        onClick={() =>
          setShowRole(!showRole)
        }
        style={{
          padding: 10,
          marginTop: 10
        }}
      >
        Mostrar mi rol
      </button>

      {showRole && miJugador && (
        <div
          style={{
            fontSize: 30,
            marginTop: 10,
            fontWeight: "bold",
            color:
              miJugador.rol ===
              "infiltrado"
                ? "red"
                : "green"
          }}
        >
          {miJugador.rol ===
          "infiltrado"
            ? "🚨 SOS INFILTRADO"
            : "✅ SOS DEL EQUIPO"}
        </div>
      )}

      <hr />

      <h3>
        Jugadores (
        {game.players.length})
      </h3>

      {game.players.map(p => (
        <div key={p.nombre}>
          {p.nombre} — Equipo {p.equipo}
        </div>
      ))}

    </div>
  );
}
