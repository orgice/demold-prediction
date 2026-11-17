/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" 면 목업 단계에서 로그인 강제를 기본으로 켠다 (auth/AuthContext.tsx) */
  readonly VITE_REQUIRE_LOGIN?: string;
}
