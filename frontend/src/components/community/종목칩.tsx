/**
 * 글이 다루는 종목 — 코드 대신 이름으로(사용자가 고른 4번).
 *
 * 예전에는 'KR 005930' 처럼 시장과 코드만 보여 줘서, 무슨 종목 글인지 알려면 코드를 외우고 있어야 했다.
 * 이름은 서버가 같이 보낸다(_종목이름). 이름을 모르면 코드를 쓴다. 시장은 색으로 남긴다(국내 파랑·해외
 * 초록·ETF 보라 — 예전 배지와 같은 색). 마우스를 올리면 시장과 코드가 보인다. 누르면 종목 화면.
 */
import { Link } from "react-router-dom";
import { cn } from "@/components/ui";

const 시장색: Record<string, string> = {
  KR:  "bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20",
  US:  "bg-accent-green/10 text-accent-green hover:bg-accent-green/20",
  ETF: "bg-accent-purple/10 text-accent-purple hover:bg-accent-purple/20",
};

export function 종목이름(name: string | null | undefined, symbol: string): string {
  return name?.trim() || symbol;
}

export default function 종목칩({ symbol, market, name, onClick, className }: {
  symbol: string;
  market: string;
  name?: string | null;
  /** 창 안에서 누르면 창을 닫는 등 */
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Link to={`/stocks/${market}/${symbol}`} onClick={onClick} title={`${market} ${symbol}`}
      className={cn("inline-flex items-center max-w-[9rem] px-2 py-0.5 rounded-lg text-xs font-semibold transition-colors",
        시장색[market] ?? 시장색.KR, className)}>
      <span className="truncate">{종목이름(name, symbol)}</span>
    </Link>
  );
}
