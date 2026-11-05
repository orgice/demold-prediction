import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import Assistant from "./pages/Assistant";
import Home from "./pages/Home";
import PourDetail from "./pages/PourDetail";
import PourList from "./pages/PourList";
import Sensors from "./pages/Sensors";
import Upload from "./pages/Upload";
import "./styles.css";

function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <div className="brand">거푸집 탈형 시점 예측<small>적산온도 기반</small></div>
        <nav className="nav">
          <NavLink to="/" end>현재 공사</NavLink>
          <NavLink to="/pours">타설 이력</NavLink>
          <NavLink to="/sensors">센서 데이터</NavLink>
          <NavLink to="/upload">데이터 업로드</NavLink>
          <NavLink to="/assistant">AI 상담</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pours" element={<PourList />} />
        <Route path="/pours/:id" element={<PourDetail />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/sensors" element={<Sensors />} />
        <Route path="/upload" element={<Upload />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
