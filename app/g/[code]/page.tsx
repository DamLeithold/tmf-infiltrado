"use client";

import { useEffect, useMemo, useState } from "react";
import {
  doc,
  onSnapshot,
  updateDoc,
  arrayUnion,
} from "firebase/firestore";
import { db, ensureAnonAuth } from "@/lib/firebase";

type Equipo = "A" | "B" | "C" | "D";

type Player = {
  nombre: string;
  equipo: Equipo;
  rol?: "equipo" | "infiltrado";
};

type VoteEntry = {
  ronda: number;
  equipo: Equipo;
  voter: string;
  target: string;
  ts: number;
};

type Scores = Record<Equipo, number>;

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

  votes?: VoteEntry[];
  scores?: Scores;
};

const EQUIPOS: readonly Equipo[] = ["A", "B", "C", "D"] as const;
const ROUND_DURATION = 300; // 5 min

const DEFAULT_SCORES: Scores = { A: 0, B: 0, C: 0, D: 0 };

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

function safeEstado(raw: any): GameDoc["estado"] {
  // compat: algunos docs viejos usan "status"
  return (raw?.estado || raw?.status || "lobby") as GameDoc["estado"];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function Lobby({ params }: { params: { code: string } }) {
  const code = params.code;

  const [game, setGame] = useState<GameDoc | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [showRole, setShowRole] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [myUid, setMyUid] = useState<string>("");
  const [hostBusy, setHostBusy] = useState(false);

  const [origin, setOrigin] = useState<string>("");

  // UI de voto
  const [voteTarget, setVoteTarget] = useState<string>("");

  const nombre =
    typeof window !== "undefined" ? localStorage.getItem("nombre") || "" : "";

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // auth anónimo
  useEffect(() => {
    (async () => {
      const u = await ensureAnonAuth();
      setMyUid(u.uid);
    })();
  }, []);

  // escuchar doc
  useEffect(() => {
    const ref = doc(db, "games", code);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setNotFound(true);
        setGame(null);
        return;
      }
      setNotFound(false);

      const raw: any = snap.data();

      const normalized: GameDoc = {
        code: raw.code || code,
        estado: safeEstado(raw),
        ronda: typeof raw.ronda === "number" ? raw.ronda : 0,
        players: Array.isArray(raw.players) ? raw.players : [],
        roundEndsAt: typeof raw.roundEndsAt === "number" ? raw.roundEndsAt : null,
        roundStartedAt:
          typeof raw.roundStartedAt === "number" ? raw.roundStartedAt : null,
        hostUid: raw.hostUid,
        reveal: !!raw.reveal,
        word: typeof raw.word === "string" ? raw.word : null,
        votes: Array.isArray(raw.votes) ? raw.votes : [],
        scores: raw.scores && typeof raw.scores === "object" ? raw.scores : DEFAULT_SCORES,
      };

      setGame(normalized);
    });
  }, [code]);

  // timer tick
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

  // ---- RONDA ----
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

      const startedAt = Date.now();
      const roundEndsAt = startedAt + ROUND_DURATION * 1000;
      const word = pickRandomWord();

      await updateDoc(doc(db, "games", code), {
        players: nuevos,
        estado: "running",
        ronda: (game.ronda || 0) + 1,
        roundStartedAt: startedAt,
        roundEndsAt,
        reveal: false,
        word,
        votes: [], // limpiamos votos para la nueva ronda
      });

      setShowRole(false);
      setVoteTarget("");
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
        roundStartedAt: null,
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

  // ✅ FINALIZAR + REVELAR + PUNTUAR (competitivo)
  async function finalizarRevelarYPuntuar() {
    if (!game) return;
    if (hostBusy) return;

    setHostBusy(true);
    try {
      const rondaActual = game.ronda || 0;
      const votes = Array.isArray(game.votes) ? game.votes : [];
      const scores: Scores = { ...DEFAULT_SCORES, ...(game.scores || {}) };

      const startedAt = game.roundStartedAt || (Date.now() - ROUND_DURATION * 1000);
      const durationMs = ROUND_DURATION * 1000;

      // helper: mayoría por equipo
      const getMajority = (teamVotes: VoteEntry[]) => {
        const tally = new Map<string, number>();
        for (const v of teamVotes) tally.set(v.target, (tally.get(v.target) || 0) + 1);

        const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
        if (sorted.length === 0) return { target: "", tie: false, count: 0 };

        // empate?
        if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
          return { target: sorted[0][0], tie: true, count: sorted[0][1] };
        }
        return { target: sorted[0][0], tie: false, count: sorted[0][1] };
      };

      // infiltrado real por equipo
      const infiltradoRealPorEquipo: Record<Equipo, string> = {
        A: "",
        B: "",
        C: "",
        D: "",
      };
      for (const eq of EQUIPOS) {
        const inf = (game.players || []).find(
          (p) => p.equipo === eq && p.rol === "infiltrado"
        );
        infiltradoRealPorEquipo[eq] = inf?.nombre || "";
      }

      // calcular delta puntos por equipo
      const deltas: Scores = { A: 0, B: 0, C: 0, D: 0 };

      for (const eq of EQUIPOS) {
        const teamVotes = votes.filter((v) => v.ronda === rondaActual && v.equipo === eq);

        if (teamVotes.length === 0) {
          // no votaron
          deltas[eq] = -2;
          continue;
        }

        const { target, tie } = getMajority(teamVotes);

        if (tie) {
          // empate de votos
          deltas[eq] = 0;
          continue;
        }

        const infiltrado = infiltradoRealPorEquipo[eq];
        const acertaron = infiltrado && target === infiltrado;

        if (acertaron) {
          // base
          let pts = 3;

          // bonus rapidez: tomamos el primer voto del equipo (cualquiera) como referencia
          const firstVoteTs = teamVotes.reduce((min, v) => Math.min(min, v.ts), teamVotes[0].ts);
          const progress = clamp((firstVoteTs - startedAt) / durationMs, 0, 1);

          // <=50% del tiempo: +2, 50-80%: +1, >80%: +0
          if (progress <= 0.5) pts += 2;
          else if (progress <= 0.8) pts += 1;

          deltas[eq] = pts;
        } else {
          deltas[eq] = -1;
        }
      }

      // aplicar puntos
      const newScores: Scores = { ...scores };
      for (const eq of EQUIPOS) newScores[eq] = (newScores[eq] || 0) + deltas[eq];

      await updateDoc(doc(db, "games", code), {
        reveal: true,
        estado: "results",
        roundEndsAt: null,
        scores: newScores,
        lastDeltas: deltas, // opcional (por si querés mostrar “qué sumó cada uno”)
      });
    } catch (e: any) {
      alert(`Error al puntuar: ${e?.message || e}`);
    } finally {
      setHostBusy(false);
    }
  }

  // ---- VOTO jugador ----
  async function enviarVoto() {
    if (!game || !miJugador) return;
    if (!voteTarget) return alert("Elegí a quién votás primero.");

    if (game.estado !== "running") {
      return alert("La ronda no está en curso.");
    }

    const entry: VoteEntry = {
      ronda: game.ronda || 0,
      equipo: miJugador.equipo,
      voter: miJugador.nombre,
      target: voteTarget,
      ts: Date.now(),
    };

    try {
      await updateDoc(doc(db, "games", code), {
        votes: arrayUnion(entry),
      });
      alert("Voto enviado ✅");
    } catch (e: any) {
      alert(`Error enviando voto: ${e?.message || e}`);
    }
  }

  async function pantallaCompleta() {
    const elem = document.documentElement;
    if (!document.fullscreenElement) await elem.requestFullscreen();
    else await document.exitFullscreen();
  }

  if (notFound) {
    return (
      <div style={{ padding: 20, fontFamily: "Arial" }}>
        <h2>Partida no encontrada</h2>
        <div style={{ opacity: 0.8 }}>
          El código <b>{code}</b> no existe (o fue borrado).
        </div>
      </div>
    );
  }

  if (!game) return <div style={{ padding: 20 }}>Cargando...</div>;

  const infiltradosPorEquipo = EQUIPOS.map((eq) => {
    const inf = (game.players || []).find(
      (p) => p.equipo === eq && p.rol === "infiltrado"
    );
    return { eq, infNombre: inf?.nombre || "—" };
  });

  // ranking por puntaje
  const scores: Scores = { ...DEFAULT_SCORES, ...(game.scores || {}) };
  const ranking = [...EQUIPOS]
    .map((eq) => ({ eq, pts: scores[eq] || 0 }))
    .sort((a, b) => b.pts - a.pts);

  // para votar: lista de jugadores de mi equipo (menos yo)
  const candidatosVoto = useMemo(() => {
    if (!game || !miJugador) return [];
    return (game.players || [])
      .filter((p) => p.equipo === miJugador.equipo)
      .map((p) => p.nombre);
  }, [game, miJugador]);

  const qrImgUrl = useMemo(() => {
    // QR por imagen (evita qrcode.react y elimina el crash)
    return `https://api.qrserver.com/v1/create-qr-code/?size=170x170&data=${encodeURIComponent(
      joinUrl
    )}`;
  }, [joinUrl]);

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

      {/* RANKING */}
      <div
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 10 }}>🏆 Ranking por equipos</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ranking.map((r, idx) => (
            <div
              key={r.eq}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                minWidth: 120,
                background: idx === 0 ? "#ecfeff" : "#f9fafb",
              }}
            >
              <div style={{ fontWeight: 900 }}>Equipo {r.eq}</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{r.pts}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {idx === 0 ? "Líder" : `Puesto #${idx + 1}`}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Sistema competitivo: acierto +3 (+bonus rapidez), fallo -1, sin voto -2, empate 0.
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
            <img src={qrImgUrl} width={170} height={170} alt="QR" />
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
              onClick={finalizarRevelarYPuntuar}
              disabled={hostBusy}
              style={{
                padding: "10px 14px",
                background: "#0f172a",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontWeight: 900,
                opacity: hostBusy ? 0.6 : 1,
              }}
            >
              Finalizar + Revelar + Puntuar
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
            * “Finalizar + Revelar + Puntuar” calcula mayoría por equipo y actualiza el ranking.
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

                {/* palabra SOLO a equipo */}
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

      {/* VOTACIÓN */}
      {miJugador && (
        <div
          style={{
            marginTop: 18,
            padding: 14,
            border: "1px solid #ddd",
            borderRadius: 12,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8 }}>📦 Votación (por equipo)</div>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 10 }}>
            Tu equipo: <b>{miJugador.equipo}</b>
          </div>

          <select
            value={voteTarget}
            onChange={(e) => setVoteTarget(e.target.value)}
            style={{
              padding: 10,
              width: "min(480px, 100%)",
              borderRadius: 10,
              border: "1px solid #d1d5db",
            }}
            disabled={game.estado !== "running"}
          >
            <option value="">Elegí a quién votás...</option>
            {candidatosVoto.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <div style={{ marginTop: 10 }}>
            <button
              onClick={enviarVoto}
              disabled={game.estado !== "running"}
              style={{
                padding: "10px 14px",
                background: game.estado === "running" ? "#16a34a" : "#9ca3af",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontWeight: 900,
              }}
            >
              Enviar voto
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Tip: si tu equipo se demora en votar, puede perder bonus de rapidez.
          </div>
        </div>
      )}

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
