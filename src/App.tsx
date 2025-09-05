import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import FancyLoader from "./components/FancyLoader";

const Home = lazy(() => import("./pages/Home"));
const Analisis = lazy(() => import("./pages/Analisis"));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<FancyLoader message="Cargando módulos…" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/analisis" element={<Analisis />} />
          {/* catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
