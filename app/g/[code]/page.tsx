"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db, ensureAnonAuth } from "@/lib/firebase";
import QRCode from "qrcode.react";

type Player = {
  nombre: string;
  equipo: "A" | "B" | "C" | "D";
  rol?: "equipo" | "infiltrado";
};

type GameDoc = {
  code: string;
  estado: "lobby" | "running" | "results";
  ronda: number;
  players: Player[];
  roundEndsAt?: number | null;
  hostUid?: string;
  reveal?: boolean;
  word?: string | null;
};

const EQUIPOS = ["A", "B", "C", "D"] as const;
const ROUND_DURATION = 300; // 5 min

const WORDS = [
  "Mate",
  "Asado",
  "Factura",
  "Excel",
  "Auditoría",
  "Café",
  "Facturación",
  "Balance",
  "Impuestos",
  "Sueldo",
  "Oficina",
  "Home office",
  "Reunión",
  "Cumpleaños",
  "Equipo",
  "Cliente",
  "Recibo",
  "Planilla",
  "Firma",
  "Turno",
];

function pickRandomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

export default function Lobby({ params }: { params: { code: string } }) {
  const code = params.code;

  const [game, setGame] = useState<GameDoc | null>(null);
  const [showRole, setShowRole] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [myUid, setMyUid] = useState<string>("");
  const [hostBusy, setHostBusy] = useState(false);

  // para construir URL del QR sin romper SSR
  const [origin, setOrigin] = useState<string>("");

  const nombre =
    typeof window !== "undefined" ? localStorage.getItem("nombre") || "" : "";

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // Obtener UID anónimo (para detectar host)
  useEffect(() => {
    (async () => {
      const u = await ensureAnonAuth();
      setMyUid(u.uid);
    })();
  }, []);

  // Escuchar game doc
  useEffect(() => {
    const ref = doc(db, "games", code);
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as GameDoc;
      setGame(data);
    });
  }, [code]);

  // Timer tick
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);

  const isHost = useMemo(() => {
    if (!game?.hostUid) return false;
    return myUid && myUid === game.hostUid;
  }, [myUid, game?.hostUid]);

  const miJugador = useMemo(() => {
    if (!game) return null;
    return game.players?.find((p) => p.nombre === nombre) || null;
  }, [game, nombre]);

  const tiempoRestante = useMemo(() => {
    if (!game?.roundEndsAt) return 0;
    const ms = (game.roundEndsAt as number) - now;
    return Math.max(0, Math.floor(ms / 1000));
  }, [game?.roundEndsAt, now]);

  const minutos = Math.floor(tiempoRestante / 60)
    .toString()
    .padStart(2, "0");
  const segundos = (tiempoRestante % 60).toString().padStart(2, "0");

  const joinUrl = useMemo(() => {
    // si todavía no tenemos origin, igual devolvemos path
    const path = `/g/${code}`;
    return origin ? `${origin}${path}` : path;
  }, [origin, code]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      alert("Link copiado ✅");
    } catch {
      // fallback
      prompt("Copiá el link:", joinUrl);
    }
  }

  async function iniciarRonda() {
    if (!game) return;
    if (hostBusy) return;

    setHostBusy(true);
    try {
      const nuevos: Player[] = (game.players || []).map((p) => ({
        ...p,
        rol: "equipo",
      }));

      // 1 infiltrado por equipo (si ese equipo tiene jugadores)
      EQUIPOS.forEach((eq) => {
        const jugadoresEquipo = nuevos.filter((p) => p.equipo === eq);
        if (jugadoresEquipo.length > 0) {
          const infiltrado =
            jugadoresEquipo[Math.floor(Math.random() * jugadoresEquipo.length)];
          infiltrado.rol = "infiltrado";
        }
      });

      const roundEndsAt = Date.now() + ROUND_DURATION * 1000;
      const word = pickRandomWord();

      await updateDoc(doc(db, "games", code), {
        players: nuevos,
        estado: "running",
        ronda: (game.ronda || 0) + 1,
        roundEndsAt,
        reveal: false,
        word,
      });

      setShowRole(false);
    } catch (e: any) {
      alert(`Error al iniciar ronda: ${e?.message || e}`);
    } finally {
      setHostBusy(false);
    }
  }

  async function finalizarRonda() {
    if (hostBusy) return;
    setHostBusy(true);
    try {
      await updateDoc(doc(db, "games", code), {
        estado: "results",
        roundEndsAt: null,
      });
    } catch (e: any) {
      alert(`Error al finalizar ronda: ${e?.message || e}`);
    } finally {
      setHostBusy(false);
    }
  }

  async function volverAlLobby() {
    if (hostBusy) return;
    setHostBusy(true);
    try {
      await updateDoc(doc(db, "games", code), {
        estado: "lobby",
        roundEndsAt: null,
        reveal: false,
      });
    } catch (e: any) {
      alert(`Error al volver al lobby: ${e?.message || e}`);
    } finally {
      setHostBusy(false);
    }
  }

  async function revelarInfiltrados() {
    if (hostBusy) return;
    setHostBusy(true);
    try {
      await updateDoc(doc(db, "games", code), {
        reveal: true,
        estado: "results",
        roundEndsAt: null,
      });
    } catch (e: any) {
      alert(`Error al revelar: ${e?.message || e}`);
    } finally {
      setHostBusy(false);
    }
  }

  async function pantallaCompleta() {
    const elem = document.documentElement;
    if (!document.fullscreenElement) await elem.requestFullscreen();
    else await document.exitFullscreen();
  }

  if (!game) return <div style={{ padding: 20 }}>Cargando...</div>;

  const infiltradosPorEquipo = EQUIPOS.map((eq) => {
    const inf = (game.players || []).find(
      (p) => p.equipo === eq && p.rol === "infiltrado"
    );
    return { eq, infNombre: inf?.nombre || "—" };
  });

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      {/* HEADER */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <img
          src="/TMF_Group.png"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/tmf-logo.png";
          }}
          style={{
            height: 40,
            width: 40,
            objectFit: "contain",
            background: "white",
            padding: 4,
            borderRadius: 8,
            border: "1px solid #e5e7eb",
          }}
          alt="TMF"
        />
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>El Infiltrado TMF</div>
          <div style={{ opacity: 0.85 }}>
            Código: <b>{code}</b> · Estado: <b>{game.estado}</b> · Ronda:{" "}
            <b>{game.ronda || 0}</b>
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <button onClick={pantallaCompleta} style={{ padding: 10 }}>
            Pantalla completa
          </button>
        </div>
      </div>

      {/* ✅ QR */}
      <div
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>QR para unirse</div>

        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div
            style={{
              padding: 10,
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              background: "#fff",
            }}
          >
            <QRCode value={joinUrl} size={170} />
          </div>

          <div style={{ minWidth: 240 }}>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
              Link directo:
            </div>

            <div
              style={{
                fontFamily: "monospace",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                wordBreak: "break-all",
              }}
            >
              {joinUrl}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={copyLink} style={{ padding: 10 }}>
                Copiar link
              </button>

              <a
                href={joinUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  padding: "10px 12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  textDecoration: "none",
                  color: "#111827",
                  background: "#fff",
                  display: "inline-block",
                }}
              >
                Abrir link
              </a>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
              Tip: si vas a proyectar, poné “Pantalla completa”.
            </div>
          </div>
        </div>
      </div>

      {/* TIMER */}
      {game.estado === "running" && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 10,
            display: "inline-block",
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>Tiempo restante</div>
          <div style={{ fontSize: 28, fontWeight: 900 }}>
            {minutos}:{segundos}
          </div>
        </div>
      )}

      {/* HOST PANEL */}
      {isHost && (
        <div
          style={{
            marginTop: 18,
            padding: 14,
            border: "2px solid #e11d48",
            borderRadius: 12,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Panel Host</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={iniciarRonda}
              disabled={hostBusy}
              style={{
                padding: "10px 14px",
                background: "#e11d48",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontWeight: 800,
                opacity: hostBusy ? 0.6 : 1,
              }}
            >
              {hostBusy ? "Procesando..." : "Iniciar / Siguiente ronda"}
            </button>

            <button
              onClick={finalizarRonda}
              disabled={hostBusy}
              style={{
                padding: "10px 14px",
                background: "#111827",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontWeight: 800,
                opacity: hostBusy ? 0.6 : 1,
              }}
            >
              Finalizar ronda
            </button>

            <button
              onClick={revelarInfiltrados}
              disabled={hostBusy}
              style={{
                padding: "10px 14px",
                background: "#16a34a",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontWeight: 800,
                opacity: hostBusy ? 0.6 : 1,
              }}
            >
              Revelar infiltrados
            </button>

            <button
              onClick={volverAlLobby}
              disabled={hostBusy}
              style={{
                padding: "10px 14px",
                background: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontWeight: 800,
                opacity: hostBusy ? 0.6 : 1,
              }}
            >
              Volver a lobby
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            * “Revelar infiltrados” fuerza modo resultados y muestra quién era el infiltrado por equipo.
          </div>
        </div>
      )}

      {/* ROLE (PLAYER SECRET) */}
      <div
        style={{
          marginTop: 18,
          padding: 14,
          border: "1px solid #ddd",
          borderRadius: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 800 }}>Tu rol (pantalla secreta)</div>
          <button
            onClick={() => setShowRole(!showRole)}
            style={{ marginLeft: "auto", padding: 10 }}
          >
            {showRole ? "Ocultar" : "Mostrar mi rol"}
          </button>
        </div>

        {showRole ? (
          <div style={{ marginTop: 12 }}>
            {!miJugador?.rol ? (
              <div style={{ opacity: 0.8 }}>
                Todavía no empezó la ronda o no tenés rol asignado.
              </div>
            ) : (
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                  color: miJugador.rol === "infiltrado" ? "#dc2626" : "#16a34a",
                }}
              >
                {miJugador.rol === "infiltrado"
                  ? "🚨 SOS INFILTRADO"
                  : "✅ SOS DEL EQUIPO"}
                <div style={{ fontSize: 14, opacity: 0.75, marginTop: 4 }}>
                  Equipo: <b>{miJugador.equipo}</b>
                </div>

                {/* Mostrar palabra SOLO a equipo */}
                {miJugador.rol === "equipo" && game.word && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 12,
                      background: "#f3f4f6",
                      color: "#111827",
                      fontSize: 22,
                      fontWeight: 900,
                      display: "inline-block",
                    }}
                  >
                    Palabra:{" "}
                    <span style={{ textTransform: "uppercase" }}>{game.word}</span>
                  </div>
                )}

                {/* Si es infiltrado, no mostrar palabra */}
                {miJugador.rol === "infiltrado" && (
                  <div style={{ marginTop: 10, fontSize: 14, opacity: 0.8 }}>
                    No tenés palabra. Improvisá 😈
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 10, opacity: 0.75 }}>
            Tocá “Mostrar mi rol” y miralo sin que lo vea nadie.
          </div>
        )}
      </div>

      {/* RESULTS */}
      {game.estado === "results" && game.reveal && (
        <div
          style={{
            marginTop: 18,
            padding: 14,
            border: "2px solid #111827",
            borderRadius: 12,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8 }}>
            📣 Infiltrados por equipo
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {infiltradosPorEquipo.map(({ eq, infNombre }) => (
              <li key={eq}>
                Equipo <b>{eq}</b>: <b>{infNombre}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* PLAYERS (roles ocultos SIEMPRE) */}
      <div
        style={{
          marginTop: 18,
          padding: 14,
          border: "1px solid #ddd",
          borderRadius: 12,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>
          Jugadores ({game.players?.length || 0})
        </div>

        {(game.players || []).map((p) => (
          <div key={p.nombre}>
            {p.nombre} — Equipo <b>{p.equipo}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
