import { useEffect } from "react";

export default function Analisis() {
  useEffect(() => {
    const prev = document.title;
    document.title = "CriptoBot Pro — Dashboard + Backtest Avanzado (v5.2)";
    return () => {
      document.title = prev;
    };
  }, []);

  // Inyectar CSS/JS una sola vez (marcados con data-cbp para no duplicar)
  useEffect(() => {
    function addLink(href: string, key: string) {
      if (document.querySelector(`link[data-cbp="${key}"]`)) return;
      const el = document.createElement("link");
      el.rel = "stylesheet";
      el.href = href;
      el.crossOrigin = "anonymous";
      el.setAttribute("data-cbp", key);
      document.head.appendChild(el);
    }

    function loadScript(src: string, key: string, type?: string) {
      return new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
          `script[data-cbp="${key}"]`
        );
        if (existing) {
          console.log(`[Analisis] ${key} ya estaba cargado`);
          return resolve();
        }
        const s = document.createElement("script");
        s.src = src;
        if (type) s.type = type;
        s.defer = true;
        s.setAttribute("data-cbp", key);
        s.onload = () => {
          console.log(`[Analisis] OK ${key}`);
          resolve();
        };
        s.onerror = (e) => {
          console.error(`[Analisis] ERROR cargando ${key} →`, src, e);
          reject(e);
        };
        document.body.appendChild(s);
      });
    }

    // CSS
    addLink(
      "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
      "bs-css"
    );
    addLink(
      "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css",
      "icons-css"
    );

    // JS en orden determinístico
    (async () => {
      try {
        // 1) Bootstrap
        await loadScript(
          "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
          "bs-js"
        );
        // 2) Chart.js
        await loadScript(
          "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js",
          "chart-js"
        );

        // 3) Tu app.js como **módulo** y con cache-buster
        const bust = String(Date.now()); // o usa import.meta.env.VITE_BUILD_ID
        await loadScript(`/analisis/app.js?v=${bust}`, "app-js", "module");

        console.log("[Analisis] Todos los scripts listos");
        // chequeos de globals que usa app.js
        // @ts-ignore
        if (!window.bootstrap)
          console.warn("[Analisis] bootstrap global no está (raro)");
        // @ts-ignore
        if (!window.Chart)
          console.warn("[Analisis] Chart global no está (raro)");
      } catch (err) {
        console.error("[Analisis] Falló la carga encadenada de scripts", err);
      }
    })();

    // Limpieza: NO quitamos scripts para no re-descargar al navegar
    // (evita condiciones de carrera con StrictMode en dev)
  }, []);

  return (
    <div>
      {/* === Tus estilos (copiados del HTML) === */}
      <style>{`
        :root { --bg:#0b0f14; --panel:#0e1622; --panel2:#0b1220; --text:#e9f1ff; --muted:#9ab0c9; --ok:#34d399; --danger:#fb7185; }
        body { background: linear-gradient(180deg,#0b0f14 0,#0a1019 100%); color: var(--text); }
        .navbar { background: rgba(10,16,25,.85); backdrop-filter: blur(6px); border-bottom: 1px solid #122133; }
        .card { background: linear-gradient(180deg, var(--panel) 0%, var(--panel2) 100%); border: 1px solid #13233b; color: var(--text); }
        .form-control,.form-select { background:#0b1220; color:var(--text); border:1px solid #1a2740; }
        .badge-chip{background:#1f2937;color:#9ab0c9;} .pill-buy{background:#0f2c24;color:#7ee1c3;} .pill-sell{background:#2c0f16;color:#f7a1b0;}
        .text-up{color:var(--ok)!important;} .text-dn{color:var(--danger)!important;}
        .small-muted{font-size:.85rem;color:#9ab0c9;}
        table thead th{position:sticky;top:0;background:#0b1220;z-index:2;}
        .table-dark{--bs-table-bg:#0b1220;--bs-table-border-color:#14233a;}
        .metric{background:#0b1220;border:1px solid #14233a;border-radius:.5rem;padding:.75rem;}
        .metric .label{color:#9ab0c9;font-size:.85rem;} .metric .value{font-size:1.25rem;font-weight:600;}
        .list-dark .edu-item{background:var(--panel2);border:1px solid #14233a;border-radius:.5rem;padding:.75rem .9rem;color:var(--text);}
        .list-dark .edu-item + .edu-item{margin-top:.5rem;}
        .edu-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.35rem;}
        .edu-title{font-weight:600;font-size:.98rem;}
        .edu-badge{padding:.15rem .45rem;border-radius:.5rem;font-size:.8rem;border:1px solid #26364f;background:#0b1220;color:var(--muted);}
        .edu-badge.buy{background:#0f2c24;color:#7ee1c3;border-color:#164539;}
        .edu-badge.sell{background:#2c0f16;color:#f7a1b0;border-color:#4a2630;}
        .edu-badge.hold{background:#151a24;color:#9ab0c9;}
        .edu-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;}
        .edu-left,.edu-right{font-size:.9rem;}
        .edu-pill{display:inline-block;padding:.15rem .45rem;border:1px solid #26364f;border-radius:999px;font-size:.8rem;color:#9ab0c9;background:#0b1220;margin-right:.35rem;}
        .edu-kv{display:flex;justify-content:space-between;gap:.5rem;}
        .edu-kv .k{color:#9ab0c9;} .edu-kv .v{font-weight:600;}
        @media (max-width: 992px){ .edu-grid{grid-template-columns:1fr;} }
      `}</style>

      {/* NAV */}
      <nav className="navbar navbar-expand-lg">
        <div className="container-fluid">
          <a className="navbar-brand text-light fw-semibold" href="/">
            🤖 CriptoBot Pro
          </a>

          <div className="ms-auto d-flex gap-2">
            <button id="runBtn" className="btn btn-sm btn-primary">
              <i className="bi bi-cpu me-1" /> Correr análisis
            </button>
            <button id="exportBtn" className="btn btn-sm btn-outline-secondary">
              <i className="bi bi-download me-1" /> Exportar JSON
            </button>
            <button
              id="exampleBtn"
              className="btn btn-sm btn-outline-light"
              data-bs-toggle="modal"
              data-bs-target="#exampleModal"
            >
              <i className="bi bi-lightbulb me-1" /> Ejemplo (top señal)
            </button>
          </div>
        </div>
      </nav>

      {/* MAIN */}
      <main className="container-fluid my-3">
        <div className="row g-3">
          <div className="col-12">
            <div className="card p-3">
              <div className="row g-2 align-items-end">
                <div className="col-md-2">
                  <label className="form-label small-muted">Moneda base</label>
                  <select id="vs" className="form-select">
                    <option value="usd" defaultValue={"usd"}>
                      USD
                    </option>
                    <option value="ars">ARS</option>
                    <option value="eur">EUR</option>
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label small-muted">Estrategia</label>
                  <select id="strategy" className="form-select">
                    <option value="momentum" defaultValue={"momentum"}>
                      Momentum
                    </option>
                    <option value="reversion">Reversión</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label small-muted">Top N</label>
                  <input
                    id="topn"
                    type="number"
                    className="form-control"
                    min={5}
                    max={25}
                    defaultValue={10}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label small-muted">Tamaño orden</label>
                  <input
                    id="size"
                    type="number"
                    className="form-control"
                    min={10}
                    step={10}
                    defaultValue={100}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label small-muted">SL/TP (×ATR)</label>
                  <input
                    id="atrMult"
                    type="number"
                    className="form-control"
                    min={0.5}
                    step={0.5}
                    defaultValue={1.5}
                  />
                </div>

                <div className="col-md-3 mt-3">
                  <label className="form-label small-muted">
                    CoinGecko API key (opcional)
                  </label>
                  <input
                    id="apiKey"
                    className="form-control"
                    type="password"
                    placeholder="x_cg_pro_api_key"
                  />
                </div>

                <div className="col-md-9 mt-3">
                  <div className="form-check form-check-inline">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="cbRSI"
                      defaultChecked
                    />
                    <label className="form-check-label" htmlFor="cbRSI">
                      RSI(14)
                    </label>
                  </div>
                  <div className="form-check form-check-inline">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="cbMACD"
                      defaultChecked
                    />
                    <label className="form-check-label" htmlFor="cbMACD">
                      MACD(12,26,9)
                    </label>
                  </div>
                  <div className="form-check form-check-inline">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="cbBB"
                      defaultChecked
                    />
                    <label className="form-check-label" htmlFor="cbBB">
                      Bollinger(20,2)
                    </label>
                  </div>
                  <div className="form-check form-check-inline">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="cbEMA200"
                      defaultChecked
                    />
                    <label className="form-check-label" htmlFor="cbEMA200">
                      EMA200
                    </label>
                  </div>
                  <div className="form-check form-check-inline">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="cb52w"
                      defaultChecked
                    />
                    <label className="form-check-label" htmlFor="cb52w">
                      52W
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Contexto */}
          <div className="col-12">
            <div className="card p-3">
              <h5>📈 Contexto de mercado</h5>
              <div className="row g-2">
                <div className="col-6 col-md-3">
                  <div className="card p-3 text-center">
                    <div className="small-muted">Cap. total</div>
                    <div id="mktCap" className="fs-5 fw-bold">
                      —
                    </div>
                  </div>
                </div>
                <div className="col-6 col-md-3">
                  <div className="card p-3 text-center">
                    <div className="small-muted">Dominancia BTC</div>
                    <div id="btcDom" className="fs-5 fw-bold">
                      —
                    </div>
                  </div>
                </div>
                <div className="col-6 col-md-3">
                  <div className="card p-3 text-center">
                    <div className="small-muted">Régimen vol.</div>
                    <div id="volReg" className="fs-6 fw-bold">
                      —
                    </div>
                  </div>
                </div>
                <div className="col-6 col-md-3">
                  <div className="card p-3 text-center">
                    <div className="small-muted">Fear & Greed</div>
                    <div id="fng" className="fs-5 fw-bold">
                      —
                    </div>
                  </div>
                </div>
              </div>
              <div className="small-muted">
                Volatilidad anualizada (30d). SL/TP por ATR.
              </div>
            </div>

            {/* Metodología */}
            <div className="card p-3 mt-3">
              <h5>📘 Metodología — qué analizamos y por qué</h5>
              <div className="small-muted">
                Combinamos <strong>técnicos de spot</strong> (RSI, MACD,
                Bollinger, EMA200, MA30, ATR, Vol30d, 52W y dist. ATH) con{" "}
                <strong>señales de Futuros</strong> (Funding 8h, L/S, OI Δ,
                Basis) para ponderar momentum y sesgo. 100% educativo.
              </div>
              <ul className="mt-2 mb-0">
                <li>
                  <strong>Funding 8h</strong>: +alto=euforia long;
                  negativo=crowd short.
                </li>
                <li>
                  <strong>Long/Short Ratio</strong>: &gt;1.2 exceso longs;
                  &lt;0.9 exceso shorts.
                </li>
                <li>
                  <strong>Open Interest Δ 24h</strong>: sube con precio subiendo
                  → confirma; sube con precio cayendo → presión shorts.
                </li>
                <li>
                  <strong>Basis</strong>: prima alta = euforia; descuento =
                  aversión.
                </li>
              </ul>
            </div>

            {/* Tabla señales */}
            <div className="card p-3 mt-3">
              <h5>🧠 Señales por moneda</h5>
              <div
                className="table-responsive"
                style={{
                  maxHeight: 520,
                  border: "1px solid #14233a",
                  borderRadius: ".5rem",
                }}
              >
                <table
                  className="table table-dark table-hover table-sm align-middle mb-0"
                  id="signalsTable"
                >
                  <thead>
                    <tr>
                      <th>Moneda</th>
                      <th className="text-end">Precio</th>
                      <th className="text-end">RSI14</th>
                      <th className="text-end">MACD</th>
                      <th className="text-end">BB pos%</th>
                      <th className="text-end">Vol anual%</th>
                      <th className="text-end">ATR%</th>
                      <th className="text-end">vs MA30%</th>
                      <th className="text-end">EMA200</th>
                      <th className="text-end">Dist ATH%</th>
                      <th className="text-end">52W%</th>
                      <th className="text-end">Funding 8h</th>
                      <th className="text-end">L/S</th>
                      <th className="text-end">OI Δ%</th>
                      <th className="text-end">Prob.↑</th>
                      <th>Señal</th>
                    </tr>
                  </thead>
                  <tbody />
                </table>
              </div>
            </div>
          </div>

          {/* Columna derecha (placeholder) */}
          <div className="col-12 col-xxl-5">{/* aquí lo que quieras */}</div>
        </div>
      </main>

      {/* Modal */}
      <div className="modal fade" id="exampleModal" tabIndex={-1}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div
            className="modal-content"
            style={{
              background: "#0b1220",
              color: "#e9f1ff",
              border: "1px solid #14233a",
            }}
          >
            <div className="modal-header">
              <h5 className="modal-title">Ejemplo de orden explicada</h5>
              <button
                type="button"
                className="btn-close btn-close-white"
                data-bs-dismiss="modal"
              />
            </div>
            <div className="modal-body">
              <div id="exampleContent">
                Corré el análisis para ver un ejemplo.
              </div>
            </div>
            <div className="modal-footer" />
          </div>
        </div>
      </div>
    </div>
  );
}
