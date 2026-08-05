/**
 * 빈 화면 — 막다른 길을 없앤다.
 *
 * 지금까지 빈 화면은 "아직 게시글이 없어요" 에서 끝났다. 처음 온 사람은
 * 거기서 뒤로 가기를 누른다. 무엇을 하면 채워지는지와, 그리로 가는 버튼까지
 * 있어야 비로소 안내다.
 *
 * 여기서 못 박는 것 —
 *   1) 갈 곳이 실제로 이어져 있는가 (버튼이 눌리는가)
 *   2) 상황마다 맞는 곳으로 보내는가 — 관심종목이 비었는데 내 자산으로
 *      보내면 안내가 아니라 헛걸음이다
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Star } from "lucide-react";

import { 빈화면 } from "../ui";

describe("빈 화면", () => {
  it("무엇이 비었는지와 무엇을 하면 되는지를 같이 알려준다", () => {
    render(
      <빈화면
        icon={Star}
        title="비교할 관심종목이 없어요"
        hint="관심 있는 종목을 담아두면 점수를 한눈에 견줄 수 있어요"
      />,
    );
    expect(screen.getByText("비교할 관심종목이 없어요")).toBeInTheDocument();
    expect(screen.getByText(/담아두면/)).toBeInTheDocument();
  });

  it("버튼을 누르면 실제로 이어진다", async () => {
    /* 여기가 안 이어지면 '버튼이 있는 막다른 길'이 되어 더 나쁘다 */
    const u = userEvent.setup();
    const 갔다 = vi.fn();
    render(
      <빈화면 icon={Star} title="비어 있어요"
             action={{ label: "관심종목 담으러 가기", onClick: 갔다 }} />,
    );
    await u.click(screen.getByRole("button", { name: "관심종목 담으러 가기" }));
    expect(갔다).toHaveBeenCalledTimes(1);
  });

  it("갈 곳이 없으면 버튼을 안 만든다", () => {
    /* 알림 마지막 장처럼 사용자가 할 게 없는 자리도 있다.
       거기에 억지로 버튼을 달면 눌러봐야 헛걸음이다 */
    render(<빈화면 icon={Star} title="더 이상 알림이 없습니다" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("작은 자리에도 들어간다", () => {
    /* 관심종목 옆 '최근 조회' 칸처럼 좁은 곳에서 큰 여백을 쓰면 넘친다 */
    const { container } = render(
      <빈화면 compact icon={Star} title="최근 조회한 종목이 없어요" />,
    );
    expect(container.querySelector(".py-8")).not.toBeNull();
    expect(container.querySelector(".py-16")).toBeNull();
  });
});
