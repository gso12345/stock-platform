/**
 * 재무제표 사용자설정 — 지표 고르기와 순서 바꾸기.
 *
 * 예전에는 화면에 두 덩어리가 따로 있었다. 위에 접이식 "지표 선택"(그룹별
 * 칩 토글), 아래에 "순서 조정"(◀ ▶ 버튼으로 한 칸씩 밀기). 둘 다 화면
 * 자리를 계속 먹었고, 정작 보려던 차트는 저 아래로 밀렸다.
 *
 * 순서를 바꾸는 방식도 앱 안에서 혼자 달랐다. 관심종목 탭과 내 자산 계좌는
 * 손잡이를 끌어서 옮기는데(ReorderableList), 여기만 화살표 버튼이었다.
 * 20개를 골라 놓고 맨 뒤 것을 앞으로 보내려면 열아홉 번 눌러야 했다.
 *
 * 그래서 다른 곳과 같은 모양으로 맞춘다 — 관리 창을 따로 열고, 그 안에서
 * 끌어서 옮긴다. 방향키도 받는다.
 */
import { useState } from "react";
import { X, Plus, Trash2, Check } from "lucide-react";
import { Modal } from "@/components/ui";
import { ReorderableList } from "@/components/common/ReorderableList";

export interface 지표옵션 {
  key: string;
  label: string;
  group: string;
  color: string;
}

export default function MetricManagerModal({
  전체, 선택된, 최대 = 20, onChange, onClose,
}: {
  전체: readonly 지표옵션[];
  선택된: string[];
  최대?: number;
  onChange: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [추가열림, set추가열림] = useState(선택된.length === 0);

  const 고른것 = 선택된
    .map((k) => 전체.find((o) => o.key === k))
    .filter((o): o is 지표옵션 => !!o);

  const 그룹들 = [...new Set(전체.map((o) => o.group))];
  const 꽉참 = 선택된.length >= 최대;

  return (
    <Modal maxWidth="max-w-sm" onClose={onClose}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <div>
          <h3 className="text-sm font-bold text-text-primary">지표 관리</h3>
          <p className="text-2xs text-text-dim mt-0.5">
            끌어서 차트·표에 나오는 순서를 바꿉니다 · {선택된.length}/{최대}
          </p>
        </div>
        <button aria-label="닫기" onClick={onClose}>
          <X size={14} className="text-text-muted hover:text-text-primary" />
        </button>
      </div>

      {고른것.length > 0 ? (
        <ReorderableList
          items={고른것.map((o) => ({ id: o.key, 지표: o }))}
          onReorder={(순서) => onChange(순서 as string[])}
          itemKey="data-metric-row"
          className="flex flex-col max-h-80 overflow-y-auto"
        >
          {({ 지표 }, { handle }) => (
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/40 select-none">
              {handle}
              {/* 차트에서 쓰는 색을 여기서도 보여준다 — 어느 선이
                  어느 지표인지 창을 닫고 나서 헤매지 않게 */}
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 지표.color }} />
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-sm font-medium text-text-primary truncate">{지표.label}</span>
                <span className="text-2xs text-text-dim">{지표.group}</span>
              </span>
              <button
                draggable={false}
                aria-label={`${지표.label} 빼기`}
                onClick={(e) => { e.stopPropagation(); onChange(선택된.filter((k) => k !== 지표.key)); }}
                className="p-2 text-text-muted hover:text-accent-red hover:bg-accent-red/10 rounded-lg transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </ReorderableList>
      ) : (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-text-muted">아직 고른 지표가 없어요</p>
          <p className="text-2xs text-text-dim mt-1">아래에서 보고 싶은 것을 고르세요</p>
        </div>
      )}

      <div className="border-t border-border">
        <button
          onClick={() => set추가열림((v) => !v)}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm text-text-muted hover:text-accent-blue transition-colors"
        >
          <Plus size={14} />
          지표 추가
        </button>

        {추가열림 && (
          <div className="px-4 pb-4 flex flex-col gap-3.5 max-h-72 overflow-y-auto">
            {그룹들.map((그룹) => (
              <div key={그룹}>
                <span className="text-2xs font-semibold text-text-muted mb-1.5 block">{그룹}</span>
                <div className="flex flex-wrap gap-1.5">
                  {전체.filter((o) => o.group === 그룹).map((opt) => {
                    const 골랐나 = 선택된.includes(opt.key);
                    return (
                      <button
                        key={opt.key}
                        aria-pressed={골랐나}
                        /* 꽉 찼을 때도 이미 고른 것은 눌러서 뺄 수 있어야 한다.
                           안 그러면 20개를 채운 뒤 바꿀 방법이 없다 */
                        disabled={!골랐나 && 꽉참}
                        onClick={() =>
                          onChange(골랐나
                            ? 선택된.filter((k) => k !== opt.key)
                            : [...선택된, opt.key])
                        }
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                          골랐나 ? "text-white border-transparent" : "border-border text-text-muted hover:text-text-primary"
                        }`}
                        style={골랐나 ? { background: opt.color + "cc", borderColor: opt.color } : {}}
                      >
                        {골랐나 && <Check size={11} />}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {꽉참 && (
              <p className="text-2xs text-text-dim">
                {최대}개까지 고를 수 있어요. 더 넣으려면 위에서 하나 빼세요
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
