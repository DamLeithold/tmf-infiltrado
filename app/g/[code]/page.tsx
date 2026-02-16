"use client";

import { useState, useEffect } from "react";
import {
  doc,
  onSnapshot,
  updateDoc,
  getDoc
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const equipos = ["A", "B", "C", "D"];

export default function Game({ params }) {

  const code = params.code;

  const [game, setGame] = useState(null);
  const [miRol, setMiRol] = useState(null);
  const [miNombre, setMiNombre] = useState("");

  useEffect(() => {

    const ref = doc(db, "games", code);

    return onSnapshot(ref, snap => {

      const data = snap.data();

      setGame(data);

      const jugador = data?.players?.find(p =>
        p.nombre === localStorage.getItem("nombre")
      );

      if (jugador) setMiRol(jugador.rol);

    });

  }, []);

  async function iniciarRonda() {

    const ref = doc(db, "games", code);

    const snap = await getDoc(ref);

    const data = snap.data();

    if (!data.players) return;

    const nuevos = data.players.map(p => ({
      ...p,
      rol: "equipo"
    }));

    equipos.forEach(eq => {

      const jugadoresEquipo =
        nuevos.filter(p => p.equipo === eq);

      if (jugadoresEquipo.length > 0) {

        const infiltrado =
          jugadoresEquipo[
            Math.floor(Math.random() * jugadoresEquipo.length)
          ];

        infiltrado.rol = "infiltrado";
      }

    });

    await updateDoc(ref, {
      players: nuevos,
      estado: "running",
      ronda: (data.ronda || 0) + 1
    });

  }

  if (!game) return <div>Cargando...</div>;

  return (

    <div style={{ padding: 20 }}>

      <img
        src="/tmf-logo.png"
        style={{ width: 120, marginBottom: 20 }}
      />

      <h2>
        Lobby — Código: {code}
      </h2>

      <h3>
        Ronda: {game.ronda || 0}
      </h3>

      <button onClick={iniciarRonda}
        style={{
          background: "red",
          color: "white",
          padding: 10,
          border: "none",
          marginBottom: 20
        }}>
        Iniciar ronda
      </button>

      <button onClick={iniciarRonda}
        style={{
          background: "black",
          color: "white",
          padding: 10,
          border: "none",
          marginLeft: 10
        }}>
        Siguiente ronda
      </button>

      <h3>Tu rol:</h3>

      {miRol === "infiltrado"
        ? <div style={{ color: "red", fontSize: 24 }}>
            🕵️ SOS INFILTRADO
          </div>
        : <div style={{ color: "green", fontSize: 24 }}>
            ✅ SOS DEL EQUIPO
          </div>
      }

      <h3>Jugadores:</h3>

      {game.players?.map(p => (
        <div key={p.nombre}>
          {p.nombre} — Equipo {p.equipo}
        </div>
      ))}

    </div>
  );
}
