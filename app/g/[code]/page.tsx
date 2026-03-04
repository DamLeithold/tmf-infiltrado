"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db, ensureAnonAuth } from "@/lib/firebase";
import QRCode from "qrcode.react";

type Equipo = "A" | "B" | "C" | "D";

type Player = {
  nombre: string;
  equipo: Equipo;
  rol?: "equipo" | "infiltrado";
};

type Scores = Record<Equipo, number>;

// votos: por equipo, cada votante -> acusado
type Votes = Partial<Record<Equipo, Record<string, string>>>;

type GameDoc = {
  code: string;
  estado: "lobby" | "running" | "results";
  ronda: number;
  players: Player[];
  roundEndsAt?: number | null;
  roundStartedAt?: number | null;

  hostUid?: string;
  reveal?: boolean;
  word?: string | null;

  scores?: Scores;
  votes?: Votes;
};

const EQUIPOS = ["A", "B", "C", "D"] as const;
const ROUND_DURATION = 300; // 5 min
const FAST_BONUS_WINDOW_SEC = 120; // 2 min

// Palabras
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

function emptyScores(): Scores {
  return { A: 0, B: 0, C: 0, D: 0 };
}

function emptyVotes(): Votes {
  return { A: {}, B: {}, C: {}, D: {} };
}

// devuelve el nombre más votado (o null si no hay votos / empate)
function majorityVote(votesObj?: Record<string, string>) {
  if (!votesObj) return null;
  const arr = Object.values(votesObj).filter(Boolean);
  if (arr.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const v of arr) counts[v] = (counts[v] || 0) + 1;

  let topName: string | null = null;
  let topCount = 0;
  let tie = false;

  for (const [name, c] of Object.entries(counts)) {
    if (c > topCount) {
      topName = name;
      topCount = c;
      tie = false;
    } else if (c === topCount) {
      tie = true;
    }
  }

  return tie ? null : topName;
}

export default function Lobby({ params }: { params: { code: string } }) {
  const code = params.code;

  const [game, setGame] = useState<GameDoc | null>(null);
  const [showRole, setShowRole] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [myUid, setMyUid] = useState<string>("");
  const [hostBusy, setHostBusy] = useState(false);

  // URL QR sin romper SSR
  const [origin, setOrigin] = useState<string>("");

  // voto local del jugador
  const [myVote, setMyVote] = useState<string>("");

  const nombre =
    typeof window !== "undefined" ? localStorage.getItem("nombre") || "" : "";

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // UID anónimo
  useEffect(() => {
    (async () => {
      const u = await ensureAnonAuth();
      setMyUid(u.uid);
    })();
  }, []);

  // escuchar game doc
  useEffect(() => {
    const ref = doc(db, "games", code);
    return onSnapshot(ref, (snap) => {
      const data = snap.data() as GameDoc;
      setGame(data);
    });
  }, [code]);

  // tick timer
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

  // scores seguros
  const scores: Scores = useMemo(() => {
    return game?.scores ? { ...emptyScores(), ...game.scores } : emptyScores();
  }, [game?.scores]);

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
    const path = `/g/${code}`;
    return origin ? `${origin}${path}` : path;
  }, [origin, code]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      alert("Link copiado ✅");
    } catch {
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

      // 1 infiltrado por equipo (si tiene jugadores)
      EQUIPOS.forEach((eq) => {
        const jugadoresEquipo = nuevos.filter((p) => p.equipo === eq);
        if (jugadoresEquipo.length > 0) {
          const infiltrado =
            jugadoresEquipo[Math.floor(Math.random() * jugadoresEquipo.length)];
          infiltrado.rol = "infiltrado";
        }
      });

      const roundStartedAt = Date.now();
      const roundEndsAt = roundStartedAt + ROUND_DURATION * 1000;
      const word = pickRandomWord();

      await updateDoc(doc(db, "games", code), {
        players: nuevos,
        estado: "running",
        ronda: (game.ronda || 0) + 1,
        roundStartedAt,
        roundEndsAt,
        reveal: false,
        word,
        votes: emptyVotes(), // ✅ limpiar votos al iniciar
      });

      setShowRole(false);
      setMyVote("");
    } catch (e: any) {
      alert(`Error al iniciar ronda: ${e?.message || e}`);
    } finally {
      setHostBusy(false);
    }
  }

  async function finalizarRondaSolo() {
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
        roundStartedAt: null,
        reveal: false,
        // word: null, // si querés limpiar palabra entre rondas, descomentá
        // votes: emptyVotes(), // opcional
      });
    } catch (e: any) {
      alert(`Error al volver al lobby: ${e?.message || e}`);
    } finally {
      setHostBusy(false);
    }
  }

  async function revelarInfiltradosSolo() {
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

  // ✅ COMPETITIVO: Finalizar + Revelar + Puntuar
  // - Si el equipo adivina infiltrado por mayoría: +2
  // - Si NO adivina (o empate/sin votos): infiltrado “gana”: +3
  // - Bonus si finaliza antes de 2 min: +1 para el ganador (equipo o infiltrado)
  async function finalizarRevelarPuntuar() {
    if (!game) return;
    if (hostBusy) return;

    setHostBusy(true);
    try {
      const currentScores: Scores = game.scores
        ? { ...emptyScores(), ...game.scores }
        : emptyScores();

      const startedAt = game.roundStartedAt || (game.roundEndsAt ? game.roundEndsAt - ROUND_DURATION * 1000 : null);
      const elapsedSec =
        startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : null;

      const fastBonus = elapsedSec !== null && elapsedSec <= FAST_BONUS_WINDOW_SEC;

      const votes = game.votes || emptyVotes();
      const players = game.players || [];

      const newScores: Scores = { ...currentScores };

      EQUIPOS.forEach((eq) => {
        const teamPlayers = players.filter((p) => p.equipo === eq);
        if (teamPlayers.length === 0) return; // equipo sin jugadores: no puntúa

        const infiltrado = teamPlayers.find((p) => p.rol === "infiltrado")?.nombre || null;

        // mayoría (si hay empate -> null)
        const accused = majorityVote(votes[eq]);

        // ✅ Caso: no hay infiltrado asignado (raro) => no sumar nada
        if (!infiltrado) return;

        const teamGuessed = accused && accused === infiltrado;

        if (teamGuessed) {
          newScores[eq] += 2 + (fastBonus ? 1 : 0);
        } else {
          // infiltrado “ganó”
          newScores[eq] += 3 + (fastBonus ? 1 : 0);
        }
      });

      await updateDoc(doc(db, "games", code), {
        scores: newScores,
        reveal: true,
        estado: "results",
        roundEndsAt: null,
      });
    } catch (e: any) {
      alert(`Error al puntuar: ${e?.message || e}`);
    } finally {
      setHostBusy(false);
    }
  }

  async function enviarVoto(votedName: string) {
    if (!game) return;
    if (!miJugador?.equipo) return;

    const eq = miJugador.equipo;
    const currentVotes = game.votes || emptyVotes();

    const nextTeamVotes = { ...(currentVotes[eq] || {}) };
    nextTeamVotes[nombre] = votedName;

    const nextVotes: Votes = {
      ...currentVotes,
      [eq]: nextTeamVotes,
    };

    try {
      await updateDoc(doc(db, "games", code), { votes: nextVotes });
      alert("Voto enviado ✅");
    } catch (e: any) {
      alert(`No se pudo enviar el voto: ${e?.message || e}`);
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

  // ranking ordenado
  const ranking = useMemo(() => {
    const items = EQUIPOS.map((eq) => ({ eq, pts: scores[eq] || 0 }));
    items.sort((a, b) => b.pts - a.pts);
    return items;
  }, [scores]);

  // jugadores por equipo (para UI)
  const playersByTeam = useMemo(() => {
    const map: Record<Equipo, Player[]> = { A: [], B: [], C: [], D: [] };
    for (const p of game.players || []) map[p.equipo].push(p);
    return map;
  }, [game.players]);

  // opciones de voto: solo los del mismo equipo (excluye a sí mismo)
  const voteOptions = useMemo(() => {
    if (!miJugador) return [];
    const eq = miJugador.equipo;
    return (playersByTeam[eq] || [])
      .filter((p) => p.nombre !== nombre)
      .map((p) => p.nombre);
  }, [miJugador, playersByTeam, nombre]);

  // voto ya registrado (si existe)
  const myStoredVote = useMemo(() => {
    if (!miJugador?.equipo) return "";
    const v = game.votes?.[miJugador.equipo]?.[nombre];
    return v || "";
  }, [game.votes, miJugador?.equipo, nombre]);

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

      {/* ✅ RANKING */}
      <div
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10 }}>🏆 Ranking</div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ranking.map((r, idx) => (
            <div
              key={r.eq}
              style={{
                minWidth: 140,
                padding: 12,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: idx === 0 ? "#fef3c7" : "#f9fafb",
                transition: "all 200ms ease",
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                {idx === 0 ? "🥇 Primero" : `#${idx + 1}`}
              </div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>
                Equipo {r.eq}
              </div>
              <div style={{ fontSize: 26, fontWeight: 900 }}>{r.pts}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          Puntos por ronda (competitivo): si tu equipo adivina al infiltrado <b>+2</b>. Si no, “gana” el infiltrado <b>+3</b>. Bonus por cerrar antes de 2 min: <b>+1</b>.
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

        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
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

            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
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
              onClick={finalizarRevelarPuntuar}
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
              Finalizar + Revelar + Puntuar
            </button>

            <button
              onClick={finalizarRondaSolo}
              disabled={hostBusy}
              style={{
                padding: "10px 14px",
                background: "#6b7280",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontWeight: 800,
                opacity: hostBusy ? 0.6 : 1,
              }}
            >
              Finalizar (sin puntuar)
            </button>

            <button
              onClick={revelarInfiltradosSolo}
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

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
            * “Finalizar + Revelar + Puntuar” usa la mayoría de votos por equipo. Si hay empate o no hay votos, se considera que el infiltrado “ganó”.
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
                    <span style={{ textTransform: "uppercase" }}>
                      {game.word}
                    </span>
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

      {/* ✅ VOTACIÓN (por equipo) */}
      <div
        style={{
          marginTop: 18,
          padding: 14,
          border: "1px solid #ddd",
          borderRadius: 12,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>📦 Votación (por equipo)</div>

        {!miJugador ? (
          <div style={{ opacity: 0.75 }}>
            Primero tenés que estar unido como jugador.
          </div>
        ) : game.estado !== "running" ? (
          <div style={{ opacity: 0.75 }}>
            La votación aparece durante la ronda (estado: running).
          </div>
        ) : voteOptions.length === 0 ? (
          <div style={{ opacity: 0.75 }}>
            No hay a quién votar en tu equipo (faltan compañeros).
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
              Tu equipo: <b>{miJugador.equipo}</b>
            </div>

            <select
              value={myVote || myStoredVote}
              onChange={(e) => setMyVote(e.target.value)}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "#fff",
              }}
            >
              <option value="">Elegí a quién votás…</option>
              {voteOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>

            <button
              onClick={() => {
                const v = myVote || myStoredVote;
                if (!v) return alert("Elegí a quién votar.");
                enviarVoto(v);
              }}
              style={{
                marginTop: 10,
                padding: "10px 14px",
                background: "#16a34a",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontWeight: 900,
              }}
            >
              Enviar voto
            </button>

            {myStoredVote && (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                Ya votaste: <b>{myStoredVote}</b>
              </div>
            )}
          </>
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
