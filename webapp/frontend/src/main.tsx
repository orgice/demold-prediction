// 화면(프론트엔드)의 시작점.
// 맨 위 메뉴 막대와, 주소(URL)에 따라 어떤 화면(pages/)을 보여 줄지 정한다.
//   /            현재 공사      pages/Home.tsx
//   /pours       타설 이력      pages/PourList.tsx
//   /pours/3     회차 상세      pages/PourDetail.tsx  (3 = 회차 번호)
//   /sensors     센서 데이터    pages/Sensors.tsx
//   /upload      데이터 업로드  pages/Upload.tsx
//   /assistant   AI 상담        pages/Assistant.tsx
// 서버와 주고받는 함수는 api/client.ts 에 모여 있다.
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

/** 앱 전체 틀: 위쪽 메뉴 + 주소에 맞는 화면 */
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

// index.html의 <div id="root"> 안에 앱을 그린다
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
