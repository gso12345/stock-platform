/**
 * 종목 상세의 소스를 한 덩어리로 읽는다.
 *
 * 이 화면을 검사하는 파일이 여덟이고, 전부 pages/StockDetail.tsx 하나만
 * 읽고 있었다. 탭을 별도 파일로 떼어 내자 열한 검사가 한꺼번에 깨졌다 —
 * 코드가 옮겨 갔을 뿐 동작은 그대로인데도.
 *
 * 검사가 "어느 파일에 있는가" 를 보고 있었던 셈이다. 봐야 하는 것은
 * "이 화면이 그렇게 동작하는가" 다. 그래서 파일 경계를 여기서 지운다.
 *
 * 앞으로 탭을 더 떼어 내면 아래 목록에만 추가하면 된다.
 */
import 본문 from "../../pages/StockDetail.tsx?raw";
import 재무제표탭 from "../stock/FinancialTab.tsx?raw";
import 투자의견탭 from "../stock/AnalystTab.tsx?raw";
import 작은부품 from "../stock/DetailBits.tsx?raw";

/** 화면을 이루는 모든 파일을 이어 붙인 것 */
export const 종목상세원문 = [본문, 재무제표탭, 투자의견탭, 작은부품].join("\n");

/** 본문 파일만 (파일 크기·lazy 처럼 '어느 파일인가' 가 뜻을 갖는 검사용) */
export const 종목상세본문 = 본문;

/** 주석·설명글이 검사에 걸리지 않게 걷어낸다 */
export const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

export const 종목상세코드 = 코드만(종목상세원문);
