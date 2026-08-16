/**
 * 관리자 화면 — 되돌릴 수 없는 단추 앞에 반드시 한 번 묻는다.
 *
 * 점검 전에는 확인 절차가 제각각이었다.
 *   · 글·댓글 삭제 — 제대로 된 확인 창이 있었다
 *   · 캐시 전체 초기화 — 캐시 탭에는 window.confirm 이, 대시보드에는 아무것도
 *   · 계정 정지·커뮤니티 차단 — 클릭 한 번에 바로 실행
 *
 * 계정 정지는 그 사람이 로그인을 못 하게 되는 일이다. 목록에서 옆줄을 잘못
 * 누르는 것이 가장 흔한 실수라, 무엇에 대한 일인지 이름까지 보여 줘야 한다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import 원본 from "../../pages/Admin.tsx?raw";
import 시스템원본 from "../admin/SystemTab.tsx?raw";
import ConfirmDialog from "../admin/ConfirmDialog";

const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const 코드 = 코드만(원본);
const 시스템 = 코드만(시스템원본);

describe("확인 창", () => {
  it("무엇에 대한 일인지 보여 준다", () => {
    /* 목록에서 옆줄을 잘못 누르는 것이 가장 흔한 실수다 */
    render(
      <ConfirmDialog title="계정을 정지할까요?" message="로그인할 수 없게 됩니다."
                     대상="hong123" onConfirm={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText("hong123")).toBeInTheDocument();
    expect(screen.getByText("로그인할 수 없게 됩니다.")).toBeInTheDocument();
  });

  it("취소가 기본이고 실행은 따로 눌러야 한다", async () => {
    const 실행 = vi.fn();
    const 닫기 = vi.fn();
    render(<ConfirmDialog title="t" message="m" onConfirm={실행} onClose={닫기} />);
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(실행).not.toHaveBeenCalled();
    expect(닫기).toHaveBeenCalled();
  });

  it("처리 중에는 두 번 눌리지 않는다", () => {
    /* 두 번 누르면 토글이 두 번 돌아 원래대로 돌아간다 */
    render(<ConfirmDialog title="t" message="m" 진행중 onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "처리 중..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
  });
});

describe("파괴적 단추가 바로 실행되지 않는다", () => {
  it.each([
    ["계정 정지",        /set확인\(\{ 종류: "active"/],
    ["커뮤니티 차단",     /set확인\(\{ 종류: "ban"/],
    ["대시보드 캐시 비우기", /set캐시확인\(true\)/],
    ["캐시 전체 비우기",   /set확인\(\{ 전체: true \}\)/],
    ["캐시 항목 삭제",    /set확인\(\{ 전체: false, key: item\.key \}\)/],
  ])("%s 는 확인을 거친다", (_이름, 무늬) => {
    expect(코드).toMatch(무늬);
  });

  it("파괴적 mutate 를 곧바로 부르는 단추가 없다", () => {
    /* onClick 에서 바로 mutate 를 부르면 확인 없이 실행된다.
       다만 확인 창 '안' 의 실행 단추는 그래야 맞다 — 거기서 부르는 것은
       이미 한 번 물어본 뒤다. 확인 상태를 인자로 받는지로 가른다
       (예: deleteMut.mutate(confirmDelete) 는 확인창의 단추다).
       저장(saveMut)처럼 되돌릴 수 있는 것도 뺀다. */
    const 나쁨 = [...코드.matchAll(/onClick=\{\(\) => (\w+)Mut\.mutate\(([^)]*)\)/g)]
      .filter(([, 이름, 인자]) =>
        /delete|clear|toggle|ban|remove/i.test(이름) &&
        !/confirm|확인|지울/i.test(인자))
      .map((m) => m[0]);
    expect(나쁨, `확인 없이 바로 실행: ${나쁨.join(", ")}`).toHaveLength(0);
  });

  it("window.confirm 을 쓰지 않는다", () => {
    /* 브라우저 기본 창은 앱 모양과 따로 놀고, 무엇이 지워지는지를
       보여 줄 수 없다 */
    expect(코드).not.toMatch(/window\.confirm/);
  });
});

describe("모양을 앱에 맞춘다", () => {
  it("Tailwind 팔레트를 직접 쓰지 않는다", () => {
    /* 점검 전 54회 — amber 와 orange 가 기준 없이 섞여 있었다 */
    for (const s of [코드, 시스템]) {
      expect(s).not.toMatch(/\b(?:text|bg|border|ring)-(?:amber|orange|purple|cyan|rose|emerald|pink)-\d{2,3}\b/);
    }
  });

  it("글자 크기를 px 로 못 박지 않는다", () => {
    /* 글씨크기 설정(html font-size)은 rem 만 키운다 */
    expect(코드).not.toMatch(/text-\[\d+px\]/);
    expect(시스템).not.toMatch(/text-\[\d+px\]/);
  });

  it("메인 탭에 역할과 선택 상태가 있다", () => {
    expect(코드).toMatch(/role="tablist" aria-label="관리 항목"/);
    expect(코드).toMatch(/aria-selected=\{tab === id\}/);
  });

  it("qc 를 any 로 넘기지 않는다", () => {
    /* 탭 열 개가 전부 qc: any 를 받고 있었다 */
    expect(코드).not.toMatch(/qc:\s*any/);
    expect(코드).toMatch(/type QueryClient/);
  });
});

describe("성능", () => {
  it("캐시 목록 폴링이 배경에서는 멈춘다", () => {
    /* 시스템 탭은 이미 이렇게 하는데 캐시 탭만 빠져 있었다.
       관리자 화면을 켜 둔 채 다른 일을 하면 30초마다 계속 물어본다 */
    const i = 코드.indexOf('queryKey: ["admin-cache"]');
    expect(i).toBeGreaterThan(-1);
    expect(코드.slice(i, i + 400)).toMatch(/refetchIntervalInBackground: false/);
  });
});

describe("관리 기록", () => {
  it("기록 탭이 있다", () => {
    expect(코드).toMatch(/function AdminLogTab/);
    expect(코드).toMatch(/id: "logs"/);
    expect(코드).toMatch(/tab === "logs"\s+&& <AdminLogTab \/>/);
  });

  it("되돌릴 수 없는 일을 눈에 띄게 표시한다", () => {
    expect(코드).toMatch(/되돌릴수없음/);
    for (const a of ["user.delete", "post.delete", "cache.clear"]) {
      expect(코드).toContain(a);
    }
  });

  it("백엔드에만 있던 runtime 을 화면에서도 쓴다", () => {
    expect(코드).toMatch(/getRuntime:/);
  });
});
