"use client";

import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { useState } from "react";

function withTimeout<T>(p: Promise<T>, ms = 15000) {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timeout (15s)")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); })
     .catch((e) => { clearTimeout(t); reject(e); });
  });
}

export default function HostPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  async function crearPartida() {
    try {
      setLoading(true);
      setStatus("1/4 Importando Firebase...");

      const { ensureAnonAuth, db } = await withTimeout(import("../../lib/firebase"));
      const { doc, setDoc, serverTimestamp } = await withTimeout(import("firebase/firestore"));

      setStatus("2/4 Autenticando anónimo...");
      const user = await withTimeout(ensureAnonAuth());

      setStatus("3/4 Creando código...");
      const code = nanoid(6).toUpperCase();

      setStatus("4/4 Guardando en Firestore...");
      await withTimeout(
        setDoc(doc(db, "games", code), {
          hostUid: user.uid,
          status: "lobby",
          createdAt: serverTimestamp(),
        })
      );

      setStatus("Listo ✅ Redirigiendo...");
      router.push(`/g/${code}`);
    } catch (err: any) {
      console.error(err);
      setStatus("Error ❌ " + (err?.message || String(err)));
      alert(
        "Error:\n" +
          (err?.code ? `Código: ${err.code}\n` : "") +
          (err?.message || String(err))
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 20, fontFamily: "Arial" }}>
      <h2>Modo Host</h2>

      <button
        onClick={crearPartida}
        disabled={loading}
        style={{
          padding: 10,
          fontSize: 16,
          backgroundColor: loading ? "#9ca3af" : "#16a34a",
          color: "white",
          border: "none",
          borderRadius: 5,
        }}
      >
        {loading ? "Creando..." : "Crear nueva partida"}
      </button>

      <p style={{ marginTop: 12, color: "#333" }}>
        Estado: <b>{status || "Idle"}</b>
      </p>
    </main>
  );
}
