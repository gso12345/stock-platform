/**
 * 입력하거나 확인하는 창은 휴대폰에서도 가운데 팝업 — "종목추가, 삭제할때 밑에서 올라오는 건 좀 불편해 팝업이
 * 나을 거 같아. 팝업이 나을 거 같은 건 팝업으로 돌려줘".
 *
 * 공용 창(ui 의 Modal)은 기본이 팝업이고, 보고 고르는 창 넷(설정·앱 설치 안내·팔로워·좋아요 목록)만 '시트' 를
 * 켠다. 새 창이 슬그머니 시트를 켜지 않게, 켜는 곳을 못 박는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import ConfirmDialog from "../ui/ConfirmDialog";
import NameDialog from "../ui/NameDialog";

const 뿌리 = resolve(__dirname, "../..");

function 파일들(d: string): string[] {
  const 결과: string[] = [];
  for (const 이름 of readdirSync(d)) {
    const p = join(d, 이름);
    if (statSync(p).isDirectory()) { if (이름 !== "__tests__") 결과.push(...파일들(p)); }
    else if (p.endsWith(".tsx")) 결과.push(p);
  }
  return 결과;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === "(max-width: 639px)", media: q, addEventListener() {}, removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("휴대폰에서도 가운데 팝업", () => {
  it("삭제 확인", () => {
    render(<ConfirmDialog title="폴더 삭제" message="지울까요?" 확인글="삭제" onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByText("지울까요?")).toBeInTheDocument();
    expect(document.querySelector("[data-sheet]")).toBeNull();
    expect(document.querySelector(".modal-pop")).not.toBeNull();
  });

  it("이름 짓기", () => {
    render(<NameDialog title="새 폴더" onConfirm={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-sheet]")).toBeNull();
    expect(document.querySelector(".modal-pop")).not.toBeNull();
  });
});

describe("시트를 켜는 곳은 보고 고르는 창 다섯뿐", () => {
  /* 백테스트의 '불러오기'(저장한 실험·전략을 골라 연다)도 보고 고르는 창이라 시트다 — 입력·확인 창이 아니다 */
  it("설정·앱 설치 안내·팔로워·좋아요 목록·백테스트 불러오기", () => {
    const 켠곳 = 파일들(뿌리)
      .filter((p) => /<Modal\s+시트(?=[\s>])/.test(readFileSync(p, "utf-8")))
      .map((p) => relative(뿌리, p).replace(/\\/g, "/"))
      .sort();
    expect(켠곳).toEqual([
      "components/account/SettingsModal.tsx",
      "components/admin/PostLikesModal.tsx",
      "components/backtest/불러오기창.tsx",
      "components/layout/InstallAppButton.tsx",
      "pages/UserProfile.tsx",
    ]);
  });

  it("종목 추가·수정·매매·관리·삭제 창은 시트를 켜지 않는다", () => {
    for (const f of ["components/watchlist/WatchlistModals.tsx", "components/portfolio/PortfolioModals.tsx",
      "components/portfolio/TradeModal.tsx", "components/ui/ConfirmDialog.tsx", "components/ui/NameDialog.tsx"]) {
      const 글 = readFileSync(join(뿌리, f), "utf-8");
      expect(글, f).toMatch(/<Modal\b/);
      expect(글, f).not.toMatch(/<Modal\s+시트(?=[\s>])/);
    }
  });
});
