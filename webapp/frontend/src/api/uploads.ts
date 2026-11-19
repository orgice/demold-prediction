// CSV 업로드 기록 조회·이름 변경·삭제 (회차 상세 › 설정 › CSV 데이터).
// 백엔드: routers/sensors.py (PATCH·DELETE /api/uploads/{id}). 삭제는 관리자만 가능하다.
import { api, UploadDeleteResult, UploadLog } from "./client";

/** 이름 변경·삭제가 목업인지 (화면 안내 띠 표시용). 백엔드 연결이 끝나 false */
export const UPLOADS_IS_MOCK = false;

export const uploadsApi = {
  /** 업로드 기록 (최신순, 최근 100건) */
  list: (): Promise<UploadLog[]> => api.uploads(),
  /** 표시 이름 변경. 빈 문자열·null 이면 원본 파일명으로 되돌린다 */
  rename: (u: UploadLog, label: string | null): Promise<UploadLog> => api.renameUpload(u.id, label?.trim() || null),
  /** 이 CSV로 저장된 센서 데이터 삭제 (관리자) */
  remove: (u: UploadLog): Promise<UploadDeleteResult> => api.deleteUpload(u.id),
};

/** 화면에 보일 이름 */
export const uploadName = (u: UploadLog) => u.label?.trim() || u.filename;
