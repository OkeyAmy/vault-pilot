import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/shell";
import { Home } from "./pages/Home";
import { Tournament } from "./pages/Tournament";
import { Receipts } from "./pages/Receipts";
import { PolicyPage } from "./pages/PolicyPage";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tournament" element={<Tournament />} />
          <Route path="/receipts" element={<Receipts />} />
          <Route path="/policy" element={<PolicyPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  </StrictMode>,
);
