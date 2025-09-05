/**
 * Loader animado tipo “órbitas” con mensaje opcional.
 * No requiere Tailwind extra ni librerías.
 */
export default function FancyLoader({
  message = "Cargando…",
}: {
  message?: string;
}) {
  return (
    <div className="min-h-[50vh] grid place-items-center bg-neutral-950 text-neutral-100">
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-24 h-24">
          <div className="absolute inset-0 rounded-full border border-neutral-700/50" />
          <div className="absolute inset-0 animate-spin-slow">
            <Dot angleDeg={0} />
            <Dot angleDeg={120} />
            <Dot angleDeg={240} />
          </div>
          <div className="absolute inset-0 animate-spin-rev">
            <SmallDot angleDeg={60} />
            <SmallDot angleDeg={180} />
            <SmallDot angleDeg={300} />
          </div>
        </div>
        <div className="text-sm text-neutral-300">{message}</div>
      </div>

      {/* Estilos locales del loader */}
      <style>{`
        @keyframes spinSlow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spinRev  { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        .animate-spin-slow { animation: spinSlow 2.8s linear infinite; }
        .animate-spin-rev  { animation: spinRev  4.2s linear infinite; }
      `}</style>
    </div>
  );
}

function Dot({ angleDeg }: { angleDeg: number }) {
  const r = 40; // radio
  const rad = (angleDeg * Math.PI) / 180;
  const x = 48 + r * Math.cos(rad);
  const y = 48 + r * Math.sin(rad);
  return (
    <span
      className="absolute block w-3 h-3 rounded-full"
      style={{
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        background:
          "radial-gradient(circle at 30% 30%, rgba(99,102,241,1), rgba(59,130,246,0.2))",
        boxShadow: "0 0 16px 4px rgba(99,102,241,0.35)",
      }}
    />
  );
}
function SmallDot({ angleDeg }: { angleDeg: number }) {
  const r = 26;
  const rad = (angleDeg * Math.PI) / 180;
  const x = 48 + r * Math.cos(rad);
  const y = 48 + r * Math.sin(rad);
  return (
    <span
      className="absolute block w-2 h-2 rounded-full"
      style={{
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        background:
          "radial-gradient(circle at 30% 30%, rgba(16,185,129,1), rgba(16,185,129,0.2))",
        boxShadow: "0 0 12px 3px rgba(16,185,129,0.35)",
      }}
    />
  );
}
