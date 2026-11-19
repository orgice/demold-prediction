// 센서 목록 조회·이름 변경·숨기기·삭제 (센서 데이터 화면 › 센서 관리).
// 백엔드: routers/sensors.py (PATCH·DELETE /api/sensors/{mac}). 삭제는 관리자만 가능하다.
import { api, Pour, SensorDeleteResult, SensorInfo } from "./client";

/** 이름 변경·숨기기·삭제가 목업인지 (화면 안내 표시용). 백엔드 연결이 끝나 false */
export const SENSORS_IS_MOCK = false;

export const sensorsApi = {
  /** 센서 목록 (숨긴 센서 포함, hidden 표시) */
  list: (): Promise<SensorInfo[]> => api.sensors(),
  /** 표시 이름 변경. 빈 문자열·null 이면 MAC 으로 되돌린다 */
  rename: (s: SensorInfo, label: string | null): Promise<SensorInfo> => api.updateSensor(s.mac, { label: label?.trim() || null }),
  /** 목록에서 숨기기·다시 보이기 (데이터는 그대로) */
  setHidden: (s: SensorInfo, hidden: boolean): Promise<SensorInfo> => api.updateSensor(s.mac, { hidden }),
  /** 이 센서의 측정 기록 전체 삭제 (되돌릴 수 없음, 관리자). pours 는 목업 시절 인자라 쓰지 않는다 */
  remove: (s: SensorInfo, _pours?: Pour[]): Promise<SensorDeleteResult> => api.deleteSensor(s.mac),
};

/** 화면에 보일 이름 */
export const sensorName = (s: Pick<SensorInfo, "mac" | "label">) => s.label?.trim() || s.mac;
