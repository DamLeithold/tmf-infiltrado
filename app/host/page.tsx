export const dynamic = "force-dynamic";
"use client";

import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, ensureAnonAuth } from "../../lib/firebase";

export default function HostPage() {
  const router = useRouter();

  async function crearPartida() {
    const user = await ensureAnonAuth();
    const code = nanoid(6).toUpperCase();

    await setDoc(doc(db, "games", code), {
      hostUid: user.uid,
      status: "lobby",
      createdAt: serverTimestamp()
    });

    router.push(`/g/${code}`);
  }

  return (
    <main style={{ padding: 20 }}>
      <h2>Modo Host</h2>

      <button
        onClick={crearPartida}
        style={{
          padding: 10,
          fontSize: 16,
          backgroundColor: "#16a34a",
          color: "white",
          border: "none",
          borderRadius: 5
        }}
      >
        Crear nueva partida
      </button>

    </main>
  );
}
