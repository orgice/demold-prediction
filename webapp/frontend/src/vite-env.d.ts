/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 로그인 강제는 기본 켜짐. "false" 면 끈다 (개발용, auth/AuthContext.tsx) */
  readonly VITE_REQUIRE_LOGIN?: string;
}
