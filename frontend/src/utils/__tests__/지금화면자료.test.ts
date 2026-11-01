/**
 * 당겨서 새로고침이 다시 받을 자료 — 지금 화면이 쓰는 것만.
 *
 * 앱 틀의 불러오기 표시는 다음 화면을 위해 대시보드·뉴스·내 자산·관심종목을 늘 지켜본다. 공모주 화면에서 한 번
 * 당기니 그 여섯 건까지 다시 물어 11건이 나갔다(실제 브라우저). 미리 받기만 지켜보는 자료는 빼고, 지금 화면도
 * 같이 쓰는 자료는 그대로 다시 받는다.
 */
import { describe, it, expect, afterEach } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { 지금화면자료 } from "../지금화면자료";
import { 미리받는열쇠 } from "@/constants/미리받기열쇠";
import { 보유목록열쇠 } from "@/hooks/usePortfolioItems";
import { 관심목록열쇠 } from "@/hooks/useWatchlistItems";

const 끄기: Array<() => void> = [];
afterEach(() => { while (끄기.length) 끄기.pop()!(); });

/** 화면 하나가 이 열쇠의 자료를 지켜본다(받지는 않게 staleTime 을 길게) */
function 지켜보기(qc: QueryClient, 열쇠: readonly unknown[]) {
  const 보는것 = new QueryObserver(qc, { queryKey: 열쇠, queryFn: () => new Promise(() => {}), staleTime: Infinity });
  끄기.push(보는것.subscribe(() => {}));
}
const 찾기 = (qc: QueryClient, 열쇠: readonly unknown[]) => qc.getQueryCache().find({ queryKey: 열쇠, exact: true })!;

describe("지금화면자료", () => {
  it("열쇠는 불러오기 표시가 미리 받는 넷 — 대시보드 국내·해외, 뉴스 국내·해외", () => {
    expect(미리받는열쇠).toEqual({
      국내대시보드: ["dashboard-kr", "시가총액"],
      해외대시보드: ["dashboard-us", "시가총액"],
      국내뉴스: ["news", "kr", "latest"],
      해외뉴스: ["news", "us", "latest"],
    });
  });

  it("미리 받기만 지켜보는 자료는 다시 받지 않는다 — 여섯 가지 모두", () => {
    const qc = new QueryClient();
    const 열쇠들 = [...Object.values(미리받는열쇠), 보유목록열쇠, 관심목록열쇠];
    for (const 열쇠 of 열쇠들) {
      지켜보기(qc, 열쇠);
      expect(지금화면자료(찾기(qc, 열쇠)), JSON.stringify(열쇠)).toBe(false);
    }
  });

  it("지금 화면도 같이 쓰면(지켜보는 쪽이 둘) 다시 받는다 — 대시보드에서 당기면 대시보드 자료", () => {
    const qc = new QueryClient();
    지켜보기(qc, 미리받는열쇠.국내대시보드);
    지켜보기(qc, 미리받는열쇠.국내대시보드);
    expect(지금화면자료(찾기(qc, 미리받는열쇠.국내대시보드))).toBe(true);
  });

  it("다른 자료는 지켜보는 쪽이 하나여도 다시 받는다 — 공모주 화면의 공모주 자료", () => {
    const qc = new QueryClient();
    지켜보기(qc, ["ipo"]);
    expect(지금화면자료(찾기(qc, ["ipo"]))).toBe(true);
    지켜보기(qc, ["dashboard-kr", "거래대금"]);                 // 대시보드의 다른 정렬은 미리 받는 것이 아니다
    expect(지금화면자료(찾기(qc, ["dashboard-kr", "거래대금"]))).toBe(true);
  });

  it("실제로 거르기 — 공모주 화면에서 당기면 공모주 자료만 다시 묻는다", async () => {
    const qc = new QueryClient();
    const 물은것: string[] = [];
    for (const 열쇠 of [...Object.values(미리받는열쇠), 보유목록열쇠, 관심목록열쇠, ["ipo"]]) {
      const 보는것 = new QueryObserver(qc, {
        queryKey: 열쇠, staleTime: Infinity,
        queryFn: async () => { 물은것.push(JSON.stringify(열쇠)); return 1; },
      });
      끄기.push(보는것.subscribe(() => {}));
    }
    await new Promise((r) => setTimeout(r, 0));
    물은것.length = 0;
    await qc.refetchQueries({ type: "active", predicate: 지금화면자료 });
    expect(물은것).toEqual(['["ipo"]']);
  });
});
