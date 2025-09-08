// src/components/PositionForm.tsx
import { useState } from "react";

export default function PositionForm() {
  const [qty, setQty] = useState<string>("");
  const [avg, setAvg] = useState<string>("");

  const save = async () => {
    const r = await fetch("/.netlify/functions/save-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty: Number(qty), avgPrice: Number(avg) }),
    });
    alert(await r.text());
  };

  const check = async () => {
    const r = await fetch("/.netlify/functions/list-position");
    alert(await r.text());
  };

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      <b>Mi orden (promedio)</b>
      <input
        inputMode="decimal"
        placeholder="Qty (ej: 0.75)"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
      />
      <input
        inputMode="decimal"
        placeholder="Avg price USD (ej: 2200)"
        value={avg}
        onChange={(e) => setAvg(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={save}>Guardar orden</button>
        <button onClick={check}>Ver orden guardada</button>
      </div>
    </div>
  );
}
