import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";

const Home = lazy(() => import("./pages/Home"));
const Analisis = lazy(() => import("./pages/Analisis"));

export default function App() {
  return (
    <BrowserRouter>
      {/* Navbar global opcional */}
      <header className="w-full bg-neutral-900 text-neutral-200 border-b border-neutral-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <a href="/" className="font-semibold hover:opacity-80">
            Home
          </a>
          <a href="/analisis" className="hover:opacity-80">
            Análisis
          </a>
        </div>
      </header>

      <main>
        <Suspense fallback={<div className="p-6">Cargando…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/analisis" element={<Analisis />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </BrowserRouter>
  );
}
