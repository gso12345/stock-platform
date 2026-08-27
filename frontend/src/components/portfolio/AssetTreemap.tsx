/**
 * 자산 지도 — 칸 크기는 비중, 색은 오늘 등락.
 *
 * 파이 차트는 종목이 예닐곱 개를 넘어가면 못 읽는다. 조각이 얇아지고,
 * 이름은 밖으로 밀려나고, 결국 범례를 한 줄씩 눈으로 따라가야 한다.
 * 그래서 열한 번째부터는 아예 '기타' 로 뭉쳐 두고 있었다 — 스무 종목을
 * 가진 사람에게는 절반이 '기타' 인 그림이다.
 *
 * 지도는 그 문제가 없다. 칸이 화면을 꽉 채우므로 종목이 스무 개여도
 * 스무 칸이 다 보이고, 큰 칸이 큰 비중이라는 게 설명 없이 읽힌다.
 *
 * ── 색을 왜 '오늘 등락' 으로 잡았나 ──
 *
 * 수익률(매입가 대비)로 칠하면 3년 전에 산 종목은 늘 새빨갛거나
 * 새파랗다. 매일 봐도 그림이 안 바뀐다. 오늘 등락으로 칠하면 오늘
 * 무엇이 움직였는지가 한눈에 들어온다 — 자산 화면을 매일 여는 이유가
 * 그것이다.
 *
 * ── 색이 등락 색상 설정을 따른다 ──
 *
 * 초록/빨강 쓰는 사람과 빨강/파랑 쓰는 사람이 갈린다. 다른 화면이 다
 * 그 설정을 따르는데 여기만 안 따르면, 같은 화면 안에서 빨강이 한 번은
 * 오름이고 한 번은 내림이 된다.
 */
import { useMemo } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import 차트틀 from "@/components/chart/ChartFrame";
import { fmtKRWCompact } from "@/utils/formatters";
import { 가린글 } from "@/hooks/useMoney";

export interface 지도칸 {
  /** react key. 심볼이나 묶음 이름 */
  key: string;
  name: string;
  /** 평가금액(원) — 칸 크기 */
  value: number;
  /** 오늘 등락률(%). 시세를 못 받은 종목은 null */
  등락률: number | null;
  /** 전체 대비 비중(%) */
  비중: number;
}

/** 등락 색상 설정에 따른 오름/내림 색.
 *
 *  Tailwind 팔레트의 accent 값과 같은 값을 쓴다. 클래스 이름으로는
 *  SVG fill 을 못 주기 때문에 여기서는 색 자체가 필요하다. */
const 오름내림 = {
  "green-red": { 오름: "16,185,129",  내림: "239,68,68"  },   // accent-green / accent-red
  "red-blue":  { 오름: "239,68,68",   내림: "59,130,246" },   // accent-red   / accent-blue
} as const;

/** 등락률이 몇 %면 완전히 진해지는가.
 *
 *  3% 로 잡았다. 5% 로 잡으면 평범한 날에는 화면이 온통 흐려서 무엇이
 *  움직였는지 안 보이고, 1% 로 잡으면 조금만 움직여도 다 새빨개져서
 *  역시 구분이 안 된다. */
export const 짙어지는등락 = 3;

/** 칸 색이 제일 진해졌을 때의 불투명도.
 *
 *  처음에는 0.90 이었고, 진한 칸에는 흰 글씨를 얹었다. 두 테마에서
 *  실제 대비를 재 보고 바꿨다 —
 *
 *              흰 글씨      테마 글씨
 *    밝은 테마  1.2 ~ 3.4    5.3 ~ 15.0
 *    어두운 테마 3.0 ~ 13.6   2.4 ~ 11.1
 *
 *  밝은 테마에서는 흰 글씨가 **어느 진하기에서도** 4.5:1 을 못 넘는다.
 *  칸 색을 알파로 만들기 때문에, 흰 바탕 위에서는 아무리 진해도 옅은
 *  분홍·연두에 머무는 탓이다(실제 화면에서 NVDA 칸이 그랬다).
 *
 *  그래서 흰 글씨를 아예 없애고 테마 글자색만 쓴다. 대신 그 색이
 *  어두운 테마에서 흐려지지 않도록 상한을 0.55 로 내렸다 —
 *  이 값에서 제일 나쁜 경우(어두운 테마 + 초록)가 4.62:1 이다. */
export const 짙기상한 = 0.55;
/** 안 움직인 칸도 배경과는 갈려야 한다 */
export const 짙기바닥 = 0.18;

/** 시세를 못 받았거나 안 움직인 칸의 색.
 *
 *  처음에는 var(--bg-elevated) 였다. 그런데 이 지도가 얹히는 카드가
 *  var(--bg-card) 라 둘이 거의 같은 색이고, 칸 사이를 가르는 선도
 *  bg-card 다 — 실제 화면을 찍어 보니 그 칸만 통째로 사라지고 이름
 *  글자만 허공에 뜬 것처럼 보였다. 어느 쪽 바탕에서도 한 톤 뜨도록
 *  글자색을 옅게 섞는다. */
export const 무채색 = "color-mix(in srgb, var(--text-dim) 22%, transparent)";

/** 등락률 → 칸 색. null(시세 없음)이면 무채색 */
export function 칸색(등락률: number | null, 배색: keyof typeof 오름내림): string {
  if (등락률 == null || 등락률 === 0) return 무채색;
  const { 오름, 내림 } = 오름내림[배색];
  const 진하기 = 짙기바닥 + Math.min(1, Math.abs(등락률) / 짙어지는등락) * (짙기상한 - 짙기바닥);
  return `rgba(${등락률 > 0 ? 오름 : 내림},${진하기.toFixed(2)})`;
}

/** 칸 글씨는 늘 테마 글자색이다.
 *
 *  예전에는 진한 칸에 흰 글씨를 얹었다. 두 테마에서 대비를 실제로 재
 *  보니 밝은 테마에서 흰 글씨가 최대 3.4:1 밖에 안 나왔다(위 짙기상한
 *  주석에 표가 있다). 칸이 알파라서 바탕색을 따라가므로, 글자도
 *  바탕색을 따라가는 테마 글자색이 두 테마 모두에서 맞는다.
 *
 *  함수로 남겨 두는 이유는 부르는 쪽(칸 두 군데)이 색을 손으로 적지
 *  않게 하기 위해서다 — 한 곳만 고치면 그 칸만 안 읽히게 된다. */
export function 글씨색(): string {
  return "var(--text-primary)";
}

/** 칸이 이만큼은 돼야 글자를 넣는다.
 *
 *  이보다 좁으면 이름 대신 아무것도 안 쓴다 — 한 글자만 남은 이름은
 *  읽히지도 않으면서 칸만 어지럽힌다. 칸을 누르면 어차피 종목으로 간다. */
const 이름_최소너비 = 40;
const 이름_최소높이 = 22;
const 등락_최소높이 = 40;

/** 칸 너비에 맞춰 이름을 자른다.
 *
 *  예전에는 여덟 글자로 못 박았다. 그런데 칸 너비는 비중에 따라
 *  제각각이라, 좁은 칸에서는 여덟 글자가 옆 칸으로 삐져나갔다.
 *  한글은 글자 하나가 대략 글자크기만큼 넓다. */
export function 칸이름(name: string, width: number, 글자크기 = 11): string {
  const 들어갈수 = Math.floor((width - 8) / 글자크기);
  if (들어갈수 < 2) return "";
  return name.length > 들어갈수 ? `${name.slice(0, 들어갈수 - 1)}…` : name;
}

interface 칸그리기 {
  x?: number; y?: number; width?: number; height?: number;
  /** recharts 가 넘기는 깊이. 0 은 전체를 감싸는 뿌리 칸이다 */
  depth?: number;
  name?: string; 등락률?: number | null; 배색?: keyof typeof 오름내림;
  onSelect?: (name: string) => void;
}

function 한칸(props: 칸그리기) {
  const { x = 0, y = 0, width = 0, height = 0, depth, name = "", 등락률 = null, 배색 = "green-red", onSelect } = props;
  if (width <= 0 || height <= 0) return null;
  /* recharts 는 종목 칸들 말고 그 전체를 감싸는 '뿌리' 칸도 한 번 그린다.
     그 칸에는 등락률이 없어서 무채색으로 칠해지는데, 실제 화면을 재
     보니 지도 영역 전체(339×220)가 통째로 회색으로 깔리고 그 위에
     종목 칸이 얹혔다 — 시세 없는 칸이 그 위에서 두 겹으로 진해졌다. */
  if (depth === 0) return null;
  const 글자넣기 = width >= 이름_최소너비 && height >= 이름_최소높이 && !!칸이름(name, width);
  const 등락넣기 = 글자넣기 && height >= 등락_최소높이;
  const 색 = 글씨색();
  return (
    <g
      onClick={onSelect ? () => onSelect(name) : undefined}
      style={onSelect ? { cursor: "pointer" } : undefined}
    >
      <rect
        x={x} y={y} width={width} height={height}
        fill={칸색(등락률, 배색)}
        stroke="var(--bg-card)" strokeWidth={2}
        rx={4}
      />
      {글자넣기 && (
        <text
          x={x + width / 2} y={등락넣기 ? y + height / 2 - 5 : y + height / 2}
          textAnchor="middle" dominantBaseline="middle"
          /* stroke="none" 이 없으면 Treemap 의 stroke(칸 사이 가르는 선)가
             글자에까지 물려 내려온다. 실제 화면을 찍어 보니 모든 라벨에
             stroke: rgb(26,31,46) 이 걸려 글자가 뭉개져 있었다 */
          fill={색} stroke="none" fontSize={11} fontWeight={600}
        >
          {칸이름(name, width)}
        </text>
      )}
      {등락넣기 && 등락률 != null && (
        <text
          x={x + width / 2} y={y + height / 2 + 10}
          textAnchor="middle" dominantBaseline="middle"
          fill={색} stroke="none" fontSize={10} opacity={0.9}
        >
          {등락률 >= 0 ? "+" : ""}{등락률.toFixed(2)}%
        </text>
      )}
    </g>
  );
}

export default function 자산지도({
  칸들, height = 220, 가림 = false, onSelect,
}: {
  칸들: 지도칸[];
  height?: number;
  /** 금액 가리기 — 툴팁의 평가금액에만 걸린다. 등락률·비중은 금액이 아니다 */
  가림?: boolean;
  onSelect?: (name: string) => void;
}) {
  const 배색 = useSettingsStore((s) => s.colorScheme);

  /* recharts Treemap 은 value 가 0 이하인 칸을 못 그린다(넓이가 음수가
     된다). 현금을 0원으로 적어 둔 사람이 실제로 있다 */
  const 그릴것 = useMemo(
    () => 칸들.filter((c) => c.value > 0).map((c) => ({ ...c, 배색 })),
    [칸들, 배색],
  );

  if (그릴것.length === 0) {
    return (
      <div className="flex items-center justify-center text-text-muted text-xs" style={{ height }}>
        그릴 자산이 없어요
      </div>
    );
  }

  return (
    <div>
      <차트틀 height={height}>
        {(R) => (
          <R.Treemap
            data={그릴것}
            dataKey="value"
            /* 기본값(4/3)은 휴대폰 폭에서 칸이 가로로 길쭉해져 이름이
               가운데 붕 뜬다. 1 에 가깝게 두면 정사각형에 가까워진다 */
            aspectRatio={1.2}
            stroke="var(--bg-card)"
            isAnimationActive={false}
            content={<한칸 onSelect={onSelect} />}
          >
            <R.Tooltip
              contentStyle={{
                background: "var(--bg-card)", border: "1px solid var(--border-default)",
                borderRadius: 10, fontSize: 12, color: "var(--text-primary)",
              }}
              labelStyle={{ color: "var(--text-muted)" }}
              formatter={(v: number, _n: string, 칸: { payload?: 지도칸 }) => {
                const p = 칸?.payload;
                const 금액 = 가림 ? 가린글 : fmtKRWCompact(Number(v));
                const 뒤 = p?.등락률 != null
                  ? ` · 오늘 ${p.등락률 >= 0 ? "+" : ""}${p.등락률.toFixed(2)}%`
                  : "";
                return [`${금액} (${(p?.비중 ?? 0).toFixed(1)}%)${뒤}`, p?.name ?? ""];
              }}
            />
          </R.Treemap>
        )}
      </차트틀>

      {/* 색이 무엇을 뜻하는지 —
          설명이 없으면 '왜 어떤 칸은 회색인가' 를 알 수 없다.
          회색은 시세를 못 받은 종목(현금·휴장)이다 */}
      <div className="flex items-center justify-center gap-1.5 mt-2 text-2xs text-text-dim">
        <span>-{짙어지는등락}%</span>
        {[-1, -0.5, -1 / 6, 0, 1 / 6, 0.5, 1].map((몫) => (
          <span key={몫} className="w-4 h-2.5 rounded-sm"
                style={{ background: 칸색(몫 * 짙어지는등락, 배색) }} />
        ))}
        <span>+{짙어지는등락}%</span>
        <span className="ml-2">오늘 등락</span>
      </div>
    </div>
  );
}
