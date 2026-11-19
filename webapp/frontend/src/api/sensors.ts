// 센서 목록 조회·이름 변경·숨기기·삭제 (센서 데이터 화면 › 센서 관리).
// 백엔드에 해당 API가 생기기 전까지 SENSORS_IS_MOCK = true 로 목업(sensorsMock.ts)을 쓴다.
// 백엔드가 준비되면 false 로 바꾸고 sensorsMock.ts 를 지운다. 요청 내용: docs/sensor-data-api-request.md
import { api, Pour, SensorDeleteResult, SensorInfo } from "./client";
import { mockSensors } from "./sensorsMock";

/** 지금 이름 변경·숨기기·삭제가 목업인지 (화면 안내 표시용) */
export const SENSORS_IS_MOCK = true;

export const sensorsApi = {
  /** 센서 목록 (숨긴 센서 포함, hidden 표시). 목업이면 이 브라우저에서 바꾼 값을 덧입힌다 */
  list: async (): Promise<SensorInfo[]> => {
    const list = await api.sensors();
    return SENSORS_IS_MOCK ? mockSensors.apply(list) : list;
  },
  /** 표시 이름 변경. 빈 문자열·null 이면 MAC 으로 되돌린다 */
  rename: (s: SensorInfo, label: string | null): Promise<SensorInfo> => {
    const clean = label?.trim() || null;
    return SENSORS_IS_MOCK ? mockSensors.update(s, { label: clean }) : api.updateSensor(s.mac, { label: clean });
  },
  /** 목록에서 숨기기·다시 보이기 (데이터는 그대로) */
  setHidden: (s: SensorInfo, hidden: boolean): Promise<SensorInfo> =>
    SENSORS_IS_MOCK ? mockSensors.update(s, { hidden }) : api.updateSensor(s.mac, { hidden }),
  /** 이 센서의 측정 기록 전체 삭제 (되돌릴 수 없음) */
  remove: (s: SensorInfo, pours: Pour[]): Promise<SensorDeleteResult> =>
    SENSORS_IS_MOCK ? mockSensors.remove(s, pours) : api.deleteSensor(s.mac),
};

/** 화면에 보일 이름 */
export const sensorName = (s: Pick<SensorInfo, "mac" | "label">) => s.label?.trim() || s.mac;
