import { useEffect, useRef, useState, type CSSProperties } from "react";

type Entry = {
  ts: string;
  level: "LOG" | "INFO" | "WARN" | "ERROR" | "DEBUG";
  text: string;
};

export default function ConsoleViewer({ max = 300 }: { max?: number }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const preRef = useRef<HTMLPreElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const push = (level: Entry["level"], args: any[]) => {
      const ts = new Date().toISOString().split("T")[1].replace("Z", "");
      const text = args
        .map((v) => {
          try {
            if (typeof v === "string") return v;
            return JSON.stringify(
              v,
              (_k, val) => {
                void _k; // evitar TS6133
                if (val instanceof Error)
                  return {
                    name: val.name,
                    message: val.message,
                    stack: val.stack,
                  };
                return val;
              },
              2
            );
          } catch {
            return String(v);
          }
        })
        .join(" ");
      setEntries((prev) => {
        const next = [...prev, { ts, level, text }];
        return next.length > max ? next.slice(next.length - max) : next;
      });
    };

    const orig = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };

    console.log = (...a) => {
      push("LOG", a);
      orig.log(...a);
    };
    console.info = (...a) => {
      push("INFO", a);
      orig.info(...a);
    };
    console.warn = (...a) => {
      push("WARN", a);
      orig.warn(...a);
    };
    console.error = (...a) => {
      push("ERROR", a);
      orig.error(...a);
    };
    console.debug = (...a) => {
      push("DEBUG", a);
      orig.debug(...a);
    };

    const onErr = (e: ErrorEvent) =>
      push("ERROR", [`[window.onerror] ${e.message}`]);
    const onRej = (e: PromiseRejectionEvent) =>
      push("ERROR", [`[unhandledrejection] ${e.reason}`]);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);

    push("INFO", ["ConsoleViewer listo ✅"]);

    return () => {
      console.log = orig.log;
      console.info = orig.info;
      console.warn = orig.warn;
      console.error = orig.error;
      console.debug = orig.debug;
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, [max]);

  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const copy = async () => {
    const text = entries
      .map((e) => `[${e.ts}] ${e.level}: ${e.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      console.info("(copiado al portapapeles)");
    } catch {
      console.warn("No se pudo copiar");
    }
  };

  return (
    <div style={wrap}>
      <div style={header}>
        <strong>📟 Console Live</strong>
        <span style={pill}>{entries.length}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={() => setHidden((v) => !v)} style={btn}>
            {hidden ? "Mostrar" : "Ocultar"}
          </button>
          <button onClick={copy} style={btn}>
            Copiar
          </button>
          <button onClick={() => setEntries([])} style={btn}>
            Limpiar
          </button>
        </div>
      </div>
      {!hidden && (
        <pre ref={preRef} style={pre}>
          {entries.map((e, i) => (
            <div key={i}>
              <b style={{ color: colorFor(e.level) }}>
                [{e.ts}] {e.level}
              </b>
              : {e.text}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

const wrap: CSSProperties = {
  position: "fixed",
  left: 8,
  right: 8,
  bottom: 8,
  maxHeight: "40vh",
  zIndex: 99999,
  background: "#0b0b0b",
  color: "#eaeaea",
  border: "1px solid #333",
  borderRadius: 10,
  display: "flex",
  flexDirection: "column",
  font: "12px ui-monospace,Menlo,Consolas,monospace",
};
const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderBottom: "1px solid #222",
};
const pill: CSSProperties = {
  marginLeft: 8,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid #444",
  color: "#bbb",
};
const btn: CSSProperties = {
  background: "#161616",
  color: "#ddd",
  border: "1px solid #333",
  borderRadius: 8,
  padding: "4px 8px",
};
const pre: CSSProperties = {
  margin: 0,
  padding: 8,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  flex: 1,
};

function colorFor(level: Entry["level"]) {
  switch (level) {
    case "INFO":
      return "#9f9";
    case "WARN":
      return "#ffb74d";
    case "ERROR":
      return "#ff6b6b";
    case "DEBUG":
      return "#aaa";
    default:
      return "#9ad";
  }
}
