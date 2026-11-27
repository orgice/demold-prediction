// 현장 위치(시·군·구) 선택칸. 회차 설정과 새 타설 등록에서 같이 쓴다.
// 고른 위치의 기상청 예보·가까운 관측소 평년 기온으로 앞으로의 온도를 가정한다 (backend weather.py, regions.py)
import { Region } from "../api/client";
import { Info } from "./common";

export const REGION_INFO = "앞으로의 콘크리트 온도를 이 위치의 기상청 단기예보(약 4일)와 가까운 관측소의 평년 기온으로 가정합니다. 고르지 않으면 서버 기본 위치를 씁니다.";

/** 라벨 + 시·도별로 묶은 선택칸 + 어느 날씨를 쓰는지 안내. note 는 안내 문구 앞에 붙는다 */
export default function RegionField({ regions, value, onChange, note }: {
  regions: Region[]; value: string; onChange: (code: string) => void; note?: string;
}) {
  const groups = new Map<string, Region[]>();
  regions.forEach((r) => groups.set(r.sido, [...(groups.get(r.sido) ?? []), r]));
  const picked = regions.find((r) => r.code === value);
  return (
    <label className="field">
      <span>현장 위치<Info align="right">{REGION_INFO}</Info></span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">미지정 (서버 기본 위치)</option>
        {[...groups].map(([sido, rs]) => (
          <optgroup key={sido} label={sido}>
            {rs.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </optgroup>
        ))}
      </select>
      <span className="tiny">
        {note ?? ""}
        {picked ? `날씨: ${picked.name} 예보 · ${picked.station_name} 관측소 평년 기온` : "고르지 않으면 서버 기본 위치의 날씨를 씁니다."}
      </span>
    </label>
  );
}
