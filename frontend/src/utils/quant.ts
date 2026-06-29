// 퀀트 등급(S/A/B/C/D/F) 및 점수에 따른 색상 분류 — Quant.tsx, StockDetail.tsx 공용
export const GRADE_BANDS: { grade: string; range: string }[] = [
  { grade: "S", range: "90 ~ 100점" },
  { grade: "A", range: "80 ~ 90점" },
  { grade: "B", range: "60 ~ 80점" },
  { grade: "C", range: "40 ~ 60점" },
  { grade: "D", range: "20 ~ 40점" },
  { grade: "F", range: "0 ~ 20점" },
];

export function gradeColor(grade: string | null | undefined) {
  if (!grade) return "text-text-muted";
  if (grade.startsWith("S")) return "text-purple-400";
  if (grade.startsWith("A")) return "text-accent-green";
  if (grade.startsWith("B")) return "text-accent-blue";
  if (grade.startsWith("C")) return "text-accent-yellow";
  return "text-accent-red";
}

export function scoreColor(s: number | null) {
  return s == null ? "text-text-muted" : s >= 60 ? "text-accent-green" : s >= 40 ? "text-accent-yellow" : "text-accent-red";
}
