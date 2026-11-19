// CSV 업로드 기록 조회·이름 변경·삭제 (회차 상세 › 설정 › CSV 데이터).
// 백엔드에 이름 변경·삭제 API가 생기기 전까지 UPLOADS_IS_MOCK = true 로 목업(uploadsMock.ts)을 쓴다.
// 백엔드가 준비되면 false 로 바꾸고 uploadsMock.ts 를 지운다. 요청 내용: docs/csv-data-api-request.md
import { api, UploadDeleteResult, UploadLog } from "./client";
import { mockUploads } from "./uploadsMock";

/** 지금 이름 변경·삭제가 목업인지 (화면 안내 띠 표시용) */
export const UPLOADS_IS_MOCK = true;

export const uploadsApi = {
  /** 업로드 기록 (최신순, 최근 100건). 목업이면 이 브라우저에서 바꾼 이름·삭제 표시를 덧입힌다 */
  list: async (): Promise<UploadLog[]> => {
    const list = await api.uploads();
    return UPLOADS_IS_MOCK ? mockUploads.apply(list) : list;
  },
  /** 표시 이름 변경. 빈 문자열·null 이면 원본 파일명으로 되돌린다 */
  rename: (u: UploadLog, label: string | null): Promise<UploadLog> => {
    const clean = label?.trim() || null;
    return UPLOADS_IS_MOCK ? mockUploads.rename(u, clean) : api.renameUpload(u.id, clean);
  },
  /** 이 CSV로 저장된 센서 데이터 삭제 */
  remove: (u: UploadLog): Promise<UploadDeleteResult> =>
    UPLOADS_IS_MOCK ? mockUploads.remove(u) : api.deleteUpload(u.id),
};

/** 화면에 보일 이름 */
export const uploadName = (u: UploadLog) => u.label?.trim() || u.filename;
