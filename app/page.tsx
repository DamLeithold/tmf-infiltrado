"use client";

import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <main style={{
      padding: 20,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      fontFamily: "Arial"
    }}>
      <h1>🕵️ El Infiltrado TMF</h1>

      <button
        onClick={() => router.push("/host")}
        style={{
          padding: 10,
          fontSize: 16,
          backgroundColor: "#e11d48",
          color: "white",
          border: "none",
          borderRadius: 5
        }}
      >
        Crear partida (Host)
      </button>

      <button
        onClick={() => {
          const code = prompt("Ingresá el código:");
          if (code) router.push(`/g/${code.toUpperCase()}`);
        }}
        style={{
          padding: 10,
          fontSize: 16,
          backgroundColor: "#2563eb",
          color: "white",
          border: "none",
          borderRadius: 5
        }}
      >
        Unirme a partida
      </button>

    </main>
  );
}
