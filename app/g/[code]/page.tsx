"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db, ensureAnonAuth } from "@/lib/firebase";

type Team = "A" | "B" | "C" | "D";

type Player = {
  nombre: string;
  equipo: Team;
  rol?: "equipo" | "infiltrado";
};

type Scores = Record<Team, number>;
type Votes = Record<Team, Record<string, string>>; // votes[team][voterName] = suspectName

type GameDoc = {
  code?: string;

  // compat: algunos docs viejos usan status
  estado?: "lobby" | "running" | "results";
  status?: "lobby" | "running" | "results";

  ronda?: number;
  players?: Player[];

  roundEndsAt?: number | null;
  hostUid?: string;
  reveal?: boolean;

  word?: string | null;

  // NUEVO
  scores?: Scores;
  votes?: Votes;
};

const EQUIPOS: Team[] = ["A", "B", "C", "D"];
const ROUND_DURATION_DEFAULT = 300; // 5 min (si querés hacerlo editable, lo hacemos)

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

function safeEstado(g: GameDoc | null): "lobby" | "running" | "results" {
  const e = g?.estado ?? g?.status ?? "lobby";
  return e;
}

export default function Lobby({ params }: { params: { code: string } }) {
  const code = params.code;

  const [game, setGame] = useState<GameDoc | null>(null);
  const [showRole, setShowRole] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [myUid, setMyUid] = useState<string>("");
  const [hostBusy, setHostBusy] = useState(false);

  // para construir URL del QR sin SSR issues
  const [origin, setOrigin] = useState<string>("");

  const nombre =
    typeof window !== "undefined" ? localStorage.getItem("nombre") || "" : "";

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // auth anon
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
      const data = snap.data() as GameDoc | undefined;
      setGame(data ?? null);
    });
  }, [code]);

  // timer tick
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);

  const estado = useMemo(() => safeEstado(game), [game]);

  const players: Player[] = useMemo(() => {
    return (game?.players ?? []) as Player[];
  }, [game?.players]);

  const scores: Scores = useMemo(() => {
    return (game?.scores ?? emptyScores()) as Scores;
  }, [game?.scores]);

  const votes: Votes = useMemo(() => {
    return (game?.votes ?? emptyVotes()) as Votes;
  }, [game?.votes]);

  const isHost = useMemo(() => {
    if (!game?.hostUid) return false;
    return myUid === game.hostUid;
  }, [myUid, game?.hostUid]);

  const miJugador = useMemo(() => {
    if (!nombre) return null;
    return players.find((p) => p.nombre === nombre) || null;
  }, [players, nombre]);

  const joinUrl = useMemo(() => {
    const path = `/g/${code}`;
    return origin ? `${origin}${path}` : path;
  }, [origin, code]);

  const tiempoRestante = useMemo(() => {
    const ends = game?.roundEndsAt;
    if (!ends) return 0;
    const ms = ends - now;
    return Math.max(0, Math.floor(ms / 1000));
  }, [game?.roundEndsAt, now]);

  const minutos = Math.floor(tiempoRestante / 60)
    .toString()
    .padStart(2, "0");
  const segundos = (tiempoRestante % 60).toString().padStart(2, "0");

  const playersByTeam = useMemo(() => {
    const map: Record<Team, Player[]> = { A: [], B: [], C: [], D: [] };
    for (const p of players) map[p.equipo].push(p);
    return map;
  }, [players]);

  const teamSizes = useMemo(() => {
    return EQUIPOS.reduce((acc, t) => {
      acc[t] = playersByTeam[t].length;
      return acc;
    }, {} as Record<Team, number>);
  }, [playersByTeam]);

  // QR sin librería (evita el error de hooks)
  const qrImgUrl = useMemo(() => {
    // servicio simple de QR (solo imagen)
    return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
      joinUrl
    )}`;
  }, [joinUrl]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      alert("Link copiado ✅");
    } catch {
      prompt("Copiá el link:", joinUrl);
    }
  }

  // ============ SISTEMA DE PUNTOS (competitivo) ============
  // Por equipo (solo si el equipo tiene 2+ jugadores; si tiene 1, no puntúa esa ronda)
  //
  // - Si el equipo atrapa a su infiltrado (mayoría de votos): +3
  // - Bonus por unanimidad (todos votaron lo mismo y era el infiltrado): +1 extra
  // - Si NO lo atrapa: 0 (y además se suma +1 a TODOS LOS OTROS equipos activos) => genera diferencia y evita empates permanentes
  //
  // Nota: "equipos activos" = equipos con 2+ jugadores
  //
  function computeRoundScoring(currentScores: Scores, caughtByTeam: Record<Team, boolean>, unanimousCaught: Record<Team, boolean>) {
    const activeTeams = EQUIPOS.filter((t) => teamSizes[t] >= 2);
    const next = { ...currentScores };

    for (const t of activeTeams) {
      if (caughtByTeam[t]) {
        next[t] += 3;
        if (unanimousCaught[t]) next[t] += 1;
      } else {
        // el equipo falló => no suma
        // y los otros equipos activos suman +1
        for (const other of activeTeams) {
          if (other !== t) next[other] += 1;
        }
      }
    }
    return next;
  }

  function majoritySuspect(team: Team): { suspect: string | null; isUnanimous: boolean; votedCount: number } {
    const v = votes?.[team] ?? {};
    const arr = Object.values(v).filter(Boolean);
    if (arr.length === 0) return { suspect: null, isUnanimous: false, votedCount: 0 };

    const count: Record<string, number> = {};
    for (const s of arr) count[s] = (count[s] ?? 0) + 1;

    let top: string | null = null;
    let topN = -1;
    for (const [k, n] of Object.entries(count)) {
      if (n > topN) {
        top = k;
        topN = n;
      }
    }

    // unanimidad real: todos los votos iguales (y además idealmente todos votaron)
    const isUnanimous = Object.keys(count).length === 1;
    return { suspect: top, isUnanimous, votedCount: arr.length };
  }

  // ============ ACCIONES HOST ============
  async function iniciarRonda() {
    if (!game) return;
    if (hostBusy) return;

    setHostBusy(true);
    try {
      const nuevos: Player[] = players.map((p) => ({ ...p, rol: "equipo" }));

      // 1 infiltrado por equipo (si ese equipo tiene jugadores)
      for (const eq of EQUIPOS) {
        const jugadoresEquipo = nuevos.filter((p) => p.equipo === eq);
        if (jugadoresEquipo.length > 0) {
          const infiltrado =
            jugadoresEquipo[Math.floor(Math.random() * jugadoresEquipo.length)];
          infiltrado.rol = "infiltrado";
        }
      }

      const roundEndsAt = Date.now() + ROUND_DURATION_DEFAULT * 1000;
      const word = pickRandomWord();

      await updateDoc(doc(db, "games", code), {
        players: nuevos,
        // compat: guardo ambos
        estado: "running",
        status: "running",
        ronda: (game.ronda ?? 0) + 1,
        roundEndsAt,
        reveal: false,
        word,
        votes: emptyVotes(), // reset votos cada ronda
        scores: game.scores ?? emptyScores(), // asegura scores
      });

      setShowRole(false);
    } catch (e: any) {
      alert(`Error al iniciar ronda: ${e?.message || e}`);
    } finally {
      setHostBusy(false);
    }
  }

  async function finalizarYpuntuarYrevelar() {
    if (!game) return;
    if (hostBusy) return;

    setHostBusy(true);
    try {
      // identificar infiltrado por equipo
      const infiltradoPorEquipo: Record<Team, string | null> = { A: null, B: null, C: null, D: null };
      for (const t of EQUIPOS) {
        const inf = playersByTeam[t].find((p) => p.rol === "infiltrado");
        infiltradoPorEquipo[t] = inf?.nombre ?? null;
      }

      // determinar si lo atraparon (por mayoría de votos)
      const caughtByTeam: Record<Team, boolean> = { A: false, B: false, C: false, D: false };
      const unanimousCaught: Record<Team, boolean> = { A: false, B: false, C: false, D: false };

      for (const t of EQUIPOS) {
        const infName = infiltradoPorEquipo[t];
        if (!infName) continue;

        const { suspect, isUnanimous } = majoritySuspect(t);
        const caught = !!suspect && suspect === infName;

        caughtByTeam[t] = caught;

        // bonus unanimidad SOLO si fue atrapado y además unanimidad
        unanimousCaught[t] = caught && isUnanimous;
      }

      const nextScores = computeRoundScoring(scores, caughtByTeam, unanimousCaught);

      await updateDoc(doc(db, "games", code), {
        scores: nextScores,
        reveal: true,
        estado: "results",
        status: "results",
        roundEndsAt: null,
      });
    } catch (e: any) {
      alert(`Error al finalizar/puntuar: ${e?.message || e}`);
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
        status: "lobby",
        roundEndsAt: null,
        reveal: false,
        votes: emptyVotes(),
        // word: null, // si querés limpiar palabra al volver al lobby
      });
    } catch (e: any) {
      alert(`Error al volver al lobby: ${e?.message || e}`);
    } finally {
      setHostBusy(false);
    }
  }

  async function pantallaCompleta() {
    const elem = document.documentElement;
    if (!document.fullscreenElement) await elem.requestFullscreen();
    else await document.exitFullscreen();
  }

  // ============ VOTO (jugador) ============
  const [suspect, setSuspect] = useState<string>("");

  useEffect(() => {
    // cuando cambia la ronda/estado, limpiamos selección local
    setSuspect("");
  }, [game?.ronda, estado]);

  const myTeam = miJugador?.equipo ?? null;
  const alreadyVoted = useMemo(() => {
    if (!myTeam || !nombre) return false;
    return !!votes?.[myTeam]?.[nombre];
  }, [votes, myTeam, nombre]);

  async function enviarVoto() {
    if (!game || !myTeam || !nombre) return;
    if (!suspect) return alert("Elegí a quién votás primero.");
    try {
      const nextVotes: Votes = {
        ...votes,
        [myTeam]: {
          ...(votes?.[myTeam] ?? {}),
          [nombre]: suspect,
        },
      };
      await updateDoc(doc(db, "games", code), {
        votes: nextVotes,
      });
      alert("Voto enviado ✅");
    } catch (e: any) {
      alert(`Error al votar: ${e?.message || e}`);
    }
  }

  // ============ UI helpers ============
  const infiltradosPorEquipo = useMemo(() => {
    return EQUIPOS.map((eq) => {
      const inf = playersByTeam[eq].find((p) => p.rol === "infiltrado");
      return { eq, infNombre: inf?.nombre || "—" };
    });
  }, [playersByTeam]);

  const rankingOrdenado = useMemo(() => {
    const arr = EQUIPOS.map((t) => ({ team: t, pts: scores[t] ?? 0, size: teamSizes[t] ?? 0 }));
    // solo para mostrar: primero puntos, después tamaño
    arr.sort((a, b) => (b.pts - a.pts) || (b.size - a.size) || (a.team.localeCompare(b.team)));
    return arr;
  }, [scores, teamSizes]);

  if (!game) return <div style={{ padding: 20 }}>Cargando...</div>;

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
            Código: <b>{code}</b> · Estado: <b>{estado}</b> · Ronda:{" "}
            <b>{game.ronda ?? 0}</b>
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
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>🏆 Ranking por equipos</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {rankingOrdenado.map((r) => (
            <div
              key={r.team}
              style={{
                minWidth: 140,
                padding: 12,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 16 }}>Equipo {r.team}</div>
              <div style={{ fontSize: 28, fontWeight: 900 }}>{r.pts}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{r.size} jugador(es)</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          Regla: puntúan solo equipos con <b>2+</b> jugadores. Si un equipo falla, los demás equipos activos ganan +1.
        </div>
      </div>

      {/* QR */}
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
            <img src={qrImgUrl} width={180} height={180} alt="QR" />
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
      {estado === "running" && (
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
              onClick={finalizarYpuntuarYrevelar}
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
              Finalizar + Puntuar + Revelar
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
            Puntaje: +3 si atrapan infiltrado (mayoría), +1 extra si es unanimidad. Si un equipo falla, los demás equipos activos ganan +1.
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

      {/* VOTACIÓN */}
      {estado === "running" && miJugador && (
        <div
          style={{
            marginTop: 18,
            padding: 14,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            background: "#fff",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8 }}>📦 Votación (por equipo)</div>
          <div style={{ marginBottom: 8, opacity: 0.8 }}>
            Tu equipo: <b>{miJugador.equipo}</b>
          </div>

          {teamSizes[miJugador.equipo] < 2 ? (
            <div style={{ fontSize: 13, opacity: 0.8 }}>
              Tu equipo tiene menos de 2 jugadores, esta ronda no puntúa.
            </div>
          ) : (
            <>
              <select
                value={suspect}
                onChange={(e) => setSuspect(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 10 }}
                disabled={alreadyVoted}
              >
                <option value="">Elegí a quién votás...</option>
                {playersByTeam[miJugador.equipo]
                  .filter((p) => p.nombre !== nombre)
                  .map((p) => (
                    <option key={p.nombre} value={p.nombre}>
                      {p.nombre}
                    </option>
                  ))}
              </select>

              <button
                onClick={enviarVoto}
                disabled={alreadyVoted}
                style={{
                  marginTop: 10,
                  padding: 12,
                  width: "100%",
                  border: "none",
                  borderRadius: 10,
                  fontWeight: 900,
                  background: alreadyVoted ? "#9ca3af" : "#16a34a",
                  color: "white",
                }}
              >
                {alreadyVoted ? "Voto enviado ✅" : "Enviar voto"}
              </button>

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                Importante: votás solo a gente de tu equipo.
              </div>
            </>
          )}
        </div>
      )}

      {/* RESULTS */}
      {estado === "results" && game.reveal && (
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
          Jugadores ({players.length})
        </div>

        {players.length === 0 ? (
          <div style={{ opacity: 0.7 }}>Todavía no hay jugadores.</div>
        ) : (
          EQUIPOS.map((t) => (
            <div key={t} style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 900 }}>Equipo {t} ({playersByTeam[t].length})</div>
              <div style={{ paddingLeft: 12, opacity: 0.9 }}>
                {playersByTeam[t].map((p) => (
                  <div key={p.nombre}>• {p.nombre}</div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
