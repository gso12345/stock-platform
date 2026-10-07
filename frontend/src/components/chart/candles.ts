/**
 * 캔들(봉) 종류와 기간 — 차트 없이도 쓰는 값들.
 *
 * StockChart(lightweight-charts, 50KB gz 남짓)와 따로 둔다. 종목 상세는 이
 * 값들이 늘 필요하지만 캔들 차트는 '자세히' 를 눌러야 그린다 — 같은 파일에
 * 두면 값을 읽으려고 차트 라이브러리까지 따라와, 안 보이는 차트 때문에
 * 화면이 늦게 떴다. StockChart 가 그대로 다시 내보내므로 예전 import 도 된다.
 */
export const CANDLE_GROUPS = [
  { label: "분", key: "min", options: [
    { label: "1분",  value: "1m"  }, { label: "2분",  value: "2m"  },
    { label: "5분",  value: "5m"  }, { label: "15분", value: "15m" },
    { label: "30분", value: "30m" }, { label: "60분", value: "60m" },
    { label: "90분", value: "90m" },
  ]},
  { label: "일", key: "day", options: [
    { label: "1일봉",  value: "1d"  }, { label: "3일봉",  value: "3d"  },
    { label: "5일봉",  value: "5d"  }, { label: "10일봉", value: "10d" },
    { label: "30일봉", value: "30d" }, { label: "60일봉", value: "60d" },
  ]},
  { label: "주",  key: "week",  options: [{ label: "1주봉", value: "1wk" }] },
  { label: "월",  key: "month", options: [{ label: "1월봉", value: "1mo" }, { label: "3월봉", value: "3mo" }] },
  { label: "년",  key: "year",  options: [{ label: "1년봉", value: "1y"  }] },
] as const;

export const CANDLE_MAX_PERIOD: Record<string, string> = {
  "1m":"5d","2m":"60d","5m":"60d","15m":"60d","30m":"60d","60m":"2y","90m":"60d",
  "1d":"max","3d":"max","5d":"max","10d":"max","30d":"max","60d":"max",
  "1wk":"max","1mo":"max","3mo":"max","1y":"max",
};

export type ChartType = "candle" | "line" | "area";
