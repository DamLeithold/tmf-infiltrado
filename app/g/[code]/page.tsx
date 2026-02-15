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
  getDoc,
  Timestamp,
} from "firebase/firestore";
import { db, ensureAnonAuth } from "../../../lib/firebase";

type TeamId = "A" | "B" | "C" | "D";

type Game = {
  hostUid: string;
  status: "lobby" | "running" | "results";
  round?: number;
  durationSec?: number;
  startedAt?: any;
  endsAt?: any;
  teamScores?: Record<TeamId, number>;
  reveal?: boolean;
};

type Player = {
  id: string;
  name?: string;
  teamId?: TeamId;
  joinedAt?: any;
  role?: "infiltrado" | "equipo";
  roleRound?: number;
};

type Vote = {
  id: string;
  round: number;
  teamId: TeamId;
  targetUid: string;
  createdAt?: any;
};

const TEAMS: TeamId[] = ["A", "B", "C", "D"];

function nowMs() {
  return Date.now();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function LobbyPage() {
  const params = useParams();
  const code = String(params.code || "").toUpperCase();

  const [meUid, setMeUid] = useState<string | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState<TeamId>("A");
  const [players, setPlayers] = useState<Player[]>([]);
  const [roleReveal, setRoleReveal] = useState<string>("");
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  // voting
  const [myVoteTarget, setMyVoteTarget] = useState<string>("");
  const [votes, setVotes] = useState<Vote[]>([]);
  const [voteMsg, setVoteMsg] = useState<string>("");

  const joinUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/g/${code}`;
  }, [code]);

  const isHost = !!(meUid && game?.hostUid && meUid === game.hostUid);
  const round = game?.round || 0;
  const status = game?.status || "lobby";
  const durationSec = game?.durationSec || 300;

  // group players by team
  const byTeam = useMemo(() => {
    const map: Record<TeamId, Player[]> = { A: [], B: [], C: [], D: [] };
    players.forEach((p) => {
      const t = (p.teamId || "A") as TeamId;
      map[t].push(p);
    });
    return map;
  }, [players]);

  // my player doc
  const me = useMemo(() => players.find((p) => p.id === meUid) || null, [players, meUid]);

  // timer tick
  useEffect(() => {
    const i = setInterval(() => {
      if (!game?.endsAt) return;
      const endsAt = game.endsAt instanceof Timestamp ? game.endsAt.toMillis() : (game.endsAt?.toMillis?.() ?? 0);
      if (!endsAt) return;
      const left = Math.ceil((endsAt - nowMs()) / 1000);
      setSecondsLeft(clamp(left, 0, 999999));
    }, 500);

    return () => clearInterval(i);
  }, [game?.endsAt]);

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

      const unsubVotes = onSnapshot(collection(db, "games", code, "votes"), (snap) => {
        setVotes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      });

      return () => {
        unsubGame();
        unsubPlayers();
        unsubVotes();
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

  async function revealMyRole() {
    if (!meUid) return;
    const meNow = players.find((p) => p.id === meUid);
    if (!meNow?.role || meNow.roleRound !== round) {
      setRoleReveal("Todavía no empezó la ronda o no tenés rol asignado.");
      return;
    }
    setRoleReveal(meNow.role === "infiltrado" ? "🕵️ SOS EL INFILTRADO (de tu equipo)" : "✅ SOS DEL EQUIPO");
  }

  function fmtTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // HOST: start round => 1 infiltrado por equipo (si ese equipo tiene jugadores)
  async function startRound() {
    if (!isHost) return;

    // Refrescar jugadores desde server para evitar caché del snapshot
    const snap = await getDocs(collection(db, "games", code, "players"));
    const list: Player[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    // Validación mínima: por cada equipo con gente, mínimo 2 para que tenga sentido (1 infiltrado + 1 equipo)
    const teamCounts: Record<TeamId, number> = { A: 0, B: 0, C: 0, D: 0 };
    list.forEach((p) => {
      const t = (p.teamId || "A") as TeamId;
      teamCounts[t]++;
    });

    const teamsWithPeople = TEAMS.filter((t) => teamCounts[t] > 0);
    const badTeams = teamsWithPeople.filter((t) => teamCounts[t] < 2);

    if (list.length < 5) return alert("Mínimo 5 jugadores para arrancar.");
    if (badTeams.length > 0) {
      return alert(`Estos equipos tienen menos de 2 jugadores: ${badTeams.join(", ")}. Sumá gente o cambialos de equipo.`);
    }

    const nextRound = (game?.round || 0) + 1;

    // elegir infiltrado por equipo
    const infiltrados: Record<TeamId, string | null> = { A: null, B: null, C: null, D: null };

    for (const t of TEAMS) {
      const teamPlayers = list.filter((p) => (p.teamId || "A") === t);
      if (teamPlayers.length === 0) continue;
      const idx = Math.floor(Math.random() * teamPlayers.length);
      infiltrados[t] = teamPlayers[idx].id;
    }

    // set roles
    await Promise.all(
      list.map((p) => {
        const t = (p.teamId || "A") as TeamId;
        const isInf = infiltrados[t] === p.id;
        return updateDoc(doc(db, "games", code, "players", p.id), {
          role: isInf ? "infiltrado" : "equipo",
          roleRound: nextRound,
        });
      })
    );

    // reset reveal + votes for new round (delete is more work; we just ignore votes of older rounds)
    const startedAt = serverTimestamp();
    // endsAt: usamos Date.now + durationSec (en server timestamp no podemos sumar fácil). Lo hacemos con client ms y guardamos como Timestamp.
    const endsAtTs = Timestamp.fromMillis(Date.now() + durationSec * 1000);

    await updateDoc(doc(db, "games", code), {
      status: "running",
      round: nextRound,
      durationSec,
      startedAt,
      endsAt: endsAtTs,
      reveal: false,
    });

    alert("Ronda iniciada ✅");
  }

  // Player vote (solo dentro de su equipo, sobre jugadores de su equipo)
  async function submitVote() {
    if (!meUid || !me?.teamId) return alert("Primero entrá a la partida y elegí equipo.");
    if (status !== "running") return alert("La votación está habilitada solo durante la ronda.");
    if (!myVoteTarget) return alert("Elegí a quién votás.");

    const voteId = `${meUid}_${round}`;
    await setDoc(doc(db, "games", code, "votes", voteId), {
      round,
      teamId: me.teamId,
      targetUid: myVoteTarget,
      createdAt: serverTimestamp(),
    });

    setVoteMsg("✅ Voto enviado");
    setTimeout(() => setVoteMsg(""), 2000);
  }

  // HOST: finalizar + revelar + puntuar
  async function endAndReveal() {
    if (!isHost) return;

    const gameSnap = await getDoc(doc(db, "games", code));
    const g = gameSnap.data() as Game | undefined;
    if (!g) return;

    const currentRound = g.round || 0;

    // traer players y votos actuales
    const ps = await getDocs(collection(db, "games", code, "players"));
    const list: Player[] = ps.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    const vs = await getDocs(collection(db, "games", code, "votes"));
    const vlist: Vote[] = vs.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((v) => v.round === currentRound);

    // identificar infiltrado por equipo
    const infByTeam: Record<TeamId, string | null> = { A: null, B: null, C: null, D: null };
    for (const t of TEAMS) {
      const inf = list.find((p) => (p.teamId || "A") === t && p.role === "infiltrado" && p.roleRound === currentRound);
      infByTeam[t] = inf ? inf.id : null;
    }

    // tally votos por equipo
    const tally: Record<TeamId, Record<string, number>> = { A: {}, B: {}, C: {}, D: {} };
    vlist.forEach((v) => {
      if (!tally[v.teamId][v.targetUid]) tally[v.teamId][v.targetUid] = 0;
      tally[v.teamId][v.targetUid] += 1;
    });

    // ganador de voto por equipo = más votado
    const topVotedByTeam: Record<TeamId, string | null> = { A: null, B: null, C: null, D: null };
    for (const t of TEAMS) {
      const entries = Object.entries(tally[t]);
      if (entries.length === 0) continue;
      entries.sort((a, b) => b[1] - a[1]);
      topVotedByTeam[t] = entries[0][0];
    }

    // puntaje
    const prev = g.teamScores || { A: 0, B: 0, C: 0, D: 0 };
    const nextScores: Record<TeamId, number> = { ...prev };

    const resultsLines: string[] = [];

    for (const t of TEAMS) {
      if (!infByTeam[t]) continue; // si no hay equipo o no se asignó infiltrado
      const infUid = infByTeam[t]!;
      const top = topVotedByTeam[t];

      const infName = list.find((p) => p.id === infUid)?.name || "Infiltrado";
      const topName = top ? (list.find((p) => p.id === top)?.name || "Alguien") : "Sin votos";

      if (top && top === infUid) {
        nextScores[t] += 2;
        resultsLines.push(`Equipo ${t}: ✅ atrapó al infiltrado (${infName}) (+2)`);
      } else {
        nextScores[t] += 1;
        resultsLines.push(`Equipo ${t}: ❌ NO lo atrapó. Votó a ${topName}. Infiltrado era ${infName} (+1)`);
      }
    }

    await updateDoc(doc(db, "games", code), {
      status: "results",
      reveal: true,
      teamScores: nextScores,
      resultsText: resultsLines.join("\n"),
    });

    alert("Resultados listos ✅ (scrollea abajo)");
  }

  // HOST: siguiente ronda (vuelve a lobby pero mantiene puntajes)
  async function nextRound() {
    if (!isHost) return;
    await updateDoc(doc(db, "games", code), {
      status: "lobby",
      reveal: false,
      endsAt: null,
    });
    alert("Volviste a lobby ✅ Listo para iniciar otra ronda");
  }

  // UI helpers
  const myTeamPlayers = useMemo(() => {
    if (!me?.teamId) return [];
    return players.filter((p) => p.teamId === me.teamId);
  }, [players, me?.teamId]);

  const myVoteDocId = meUid ? `${meUid}_${round}` : "";
  const myVote = useMemo(() => votes.find((v) => v.id === myVoteDocId) || null, [votes, myVoteDocId]);

  const scores = game?.teamScores || { A: 0, B: 0, C: 0, D: 0 };
  const resultsText = (game as any)?.resultsText || "";

  return (
    <main style={{ padding: 20, fontFamily: "Arial", color: "#111", maxWidth: 900, margin: "0 auto" }}>
      {/* TMF-ish header */}
      <div
        style={{
          background: "#e11d48",
          color: "white",
          padding: "14px 16px",
          borderRadius: 10,
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 800 }}>🎭 El Infiltrado TMF</div>
        <div style={{ opacity: 0.95 }}>
          Código: <b>{code}</b> • Estado: <b>{status}</b> • Ronda: <b>{round}</b>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <section style={{ display: "grid", gap: 8 }}>
          <strong>QR para unirse:</strong>
          {joinUrl ? <QRCode value={joinUrl} /> : null}
          <small style={{ wordBreak: "break-all" }}>{joinUrl}</small>
        </section>

        {/* SCOREBOARD */}
        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>🏆 Ranking por equipos</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {TEAMS.map((t) => (
              <div key={t} style={{ padding: 10, borderRadius: 10, border: "1px solid #eee", textAlign: "center" }}>
                <div style={{ fontWeight: 700 }}>Equipo {t}</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{scores[t] || 0}</div>
              </div>
            ))}
          </div>
        </section>

        {/* HOST PANEL */}
        {isHost ? (
          <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Panel Host</h3>

            <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>⏱ Duración de ronda (segundos)</span>
                <input
                  type="number"
                  value={durationSec}
                  onChange={(e) => {
                    const v = clamp(parseInt(e.target.value || "300", 10), 30, 1800);
                    updateDoc(doc(db, "games", code), { durationSec: v });
                  }}
                  style={{ padding: 10, fontSize: 16 }}
                />
                <small>Ej: 300 = 5 minutos. (mín 30s, máx 30m)</small>
              </label>

              {status === "running" ? (
                <div style={{ fontSize: 18 }}>
                  ⏳ Tiempo restante: <b>{fmtTime(secondsLeft)}</b>
                </div>
              ) : null}

              <button
                onClick={startRound}
                style={{
                  padding: 12,
                  fontSize: 16,
                  backgroundColor: "#dc2626",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                }}
              >
                Iniciar ronda (1 infiltrado por equipo)
              </button>

              <button
                onClick={endAndReveal}
                style={{
                  padding: 12,
                  fontSize: 16,
                  backgroundColor: "#111827",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                }}
              >
                Finalizar + Revelar + Puntuar
              </button>

              <button
                onClick={nextRound}
                style={{
                  padding: 12,
                  fontSize: 16,
                  backgroundColor: "#2563eb",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                }}
              >
                Siguiente ronda (volver a lobby)
              </button>

              <small>
                * Iniciar ronda asigna roles. Finalizar calcula votos por equipo, revela infiltrados y suma puntaje.
              </small>
            </div>
          </section>
        ) : null}

        {/* JOIN + ROLE */}
        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Unirme</h3>

          <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
            <input
              placeholder="Tu nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ padding: 10, fontSize: 16 }}
            />

            <select value={teamId} onChange={(e) => setTeamId(e.target.value as TeamId)} style={{ padding: 10, fontSize: 16 }}>
              <option value="A">Equipo A</option>
              <option value="B">Equipo B</option>
              <option value="C">Equipo C</option>
              <option value="D">Equipo D</option>
            </select>

            <button
              onClick={joinGame}
              style={{
                padding: 12,
                fontSize: 16,
                backgroundColor: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: 8,
              }}
            >
              Entrar a la partida
            </button>

            <button
              onClick={revealMyRole}
              style={{
                padding: 12,
                fontSize: 16,
                backgroundColor: "#111827",
                color: "white",
                border: "none",
                borderRadius: 8,
              }}
            >
              Ver mi rol
            </button>

            {roleReveal ? (
              <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 10, background: "#f9fafb" }}>
                <b>{roleReveal}</b>
              </div>
            ) : null}
          </div>
        </section>

        {/* VOTING (solo durante running) */}
        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>🗳 Votación (por equipo)</h3>

          {status !== "running" ? (
            <div>La votación aparece durante la ronda.</div>
          ) : !me?.teamId ? (
            <div>Entrá a la partida para votar.</div>
          ) : (
            <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <div>
                Tu equipo: <b>{me.teamId}</b>
              </div>

              <select
                value={myVoteTarget}
                onChange={(e) => setMyVoteTarget(e.target.value)}
                style={{ padding: 10, fontSize: 16 }}
              >
                <option value="">Elegí a quién votás…</option>
                {myTeamPlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || "(sin nombre)"}
                  </option>
                ))}
              </select>

              <button
                onClick={submitVote}
                style={{
                  padding: 12,
                  fontSize: 16,
                  backgroundColor: "#16a34a",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                }}
              >
                Enviar voto
              </button>

              {myVote ? <small>✅ Ya votaste en esta ronda.</small> : null}
              {voteMsg ? <small>{voteMsg}</small> : null}
            </div>
          )}
        </section>

        {/* RESULTS */}
        {status === "results" ? (
          <section style={{ border: "2px solid #111827", borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>📣 Resultados</h3>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "Arial" }}>{resultsText || "Sin resultados aún."}</pre>

            <div style={{ marginTop: 8 }}>
              <b>Infiltrados (solo visible si reveal=true):</b>
              <ul>
                {TEAMS.map((t) => {
                  const inf = players.find((p) => p.teamId === t && p.role === "infiltrado" && p.roleRound === round);
                  return (
                    <li key={t}>
                      Equipo {t}: {inf ? (inf.name || "Infiltrado") : "—"}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        ) : null}

        {/* PLAYERS */}
        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Jugadores ({players.length})</h3>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {TEAMS.map((t) => (
              <div key={t} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                <b>Equipo {t}</b> ({byTeam[t].length})
                <ul style={{ marginTop: 8 }}>
                  {byTeam[t].map((p) => (
                    <li key={p.id}>
                      {p.name || "(sin nombre)"}
                      {isHost && p.role && p.roleRound === round ? ` — rol: ${p.role}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <small style={{ display: "block", marginTop: 10 }}>
            Tip: para que sea justo, procurá mínimo 2 jugadores por equipo si ese equipo participa.
          </small>
        </section>
      </div>
    </main>
  );
}
