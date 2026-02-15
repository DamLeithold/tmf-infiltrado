"use client";

import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { useState } from "react";

export default function HostPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function crearPartida() {
    try {
      setLoading(true);

      // Importamos Firebase recién al click (evita pantalla en blanco)
      const { ensureAnonAuth, db } = await import("../../lib/firebase");
      const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");

      const user = await ensureAnonAuth();
      const code = nanoid(6).toUpperCase();

      await setDoc(doc(db, "games", code), {
        hostUid: user.uid,
        status: "lobby",
        createdAt: serverTimestamp(),
      });

      router.push(`/g/${code}`);
    } catch (err: any) {
      console.error(err);
      alert(
        "Error en Firebase:\n" +
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

      <p style={{ marginTop: 12, color: "#555" }}>
        Si aparece un error, te lo muestro en pantalla (no debería quedar blanco).
      </p>
    </main>
  );
}
