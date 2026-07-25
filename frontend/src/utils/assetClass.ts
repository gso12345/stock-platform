/**
 * 자산유형 분류 — 내 자산·관심종목 양쪽에서 같은 기준을 쓰도록 한곳에 모았다.
 * 이전에는 두 화면이 각자 목록을 들고 있어서 한쪽만 고치면 분류가 어긋났다.
 */

export type AssetClass = "국내주식" | "해외주식" | "채권" | "금" | "현금" | "커버드콜";

/** 사용자가 직접 고를 수 있는 유형 (현금은 전용 모달에서만 만들어진다) */
export const ASSET_CLASS_OPTIONS: AssetClass[] = ["국내주식", "해외주식", "채권", "금", "커버드콜"];

const BOND_KEYWORDS = [
  "채권", "국고채", "회사채", "단기채", "장기채", "본드",
  "TLT", "BND", "AGG", "SHY", "IEF", "TIP", "LQD", "HYG", "BNDX", "TIGER 미국채", "KODEX 국고채",
];
const GOLD_KEYWORDS = ["금현물", "골드", "GLD", "IAU", "GLDM", "SGOL", "KRX금"];
const COVERED_CALL_KEYWORDS = ["커버드콜", "COVERED CALL", "COVEREDCALL", "BUYWRITE", "BUY WRITE", "JEPI", "JEPQ", "QYLD", "XYLD", "RYLD", "DIVO"];
const OVERSEAS_KEYWORDS = [
  "미국", "나스닥", "S&P", "SP500", "차이나", "중국", "일본", "글로벌", "선진국",
  "유로", "베트남", "인도", "신흥국", "해외",
];

export interface ClassifiableItem {
  market: string;
  name?: string;
  symbol: string;
  assetClass?: AssetClass | null;
}

export function classifyAsset(item: ClassifiableItem): AssetClass {
  const haystack = `${item.name ?? ""} ${item.symbol}`.toUpperCase();
  if (COVERED_CALL_KEYWORDS.some((k) => haystack.includes(k.toUpperCase()))) return "커버드콜";
  if (BOND_KEYWORDS.some((k) => haystack.includes(k.toUpperCase()))) return "채권";
  if (GOLD_KEYWORDS.some((k) => haystack.includes(k.toUpperCase()))) return "금";

  if (item.market === "KR") return "국내주식";
  if (item.market === "US") return "해외주식";

  // ETF: 종목코드가 6자리 숫자면 국내 상장 ETF, 그 외엔 해외 상장 ETF
  const isKRListed = /^\d{6}/.test(item.symbol);
  if (!isKRListed) return "해외주식";
  if (OVERSEAS_KEYWORDS.some((k) => (item.name ?? "").includes(k))) return "해외주식";
  return "국내주식";
}

/** 사용자가 직접 지정한 유형이 있으면 그걸 쓰고, 없으면 자동 분류 */
export function resolveAssetClass(item: ClassifiableItem): AssetClass {
  return item.assetClass ?? classifyAsset(item);
}
