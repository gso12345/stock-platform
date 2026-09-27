/**
 * CSV 만들기 — 칸 안의 쉼표·따옴표·줄바꿈을 **감싸서** 넣는다.
 *
 * 그냥 join(",") 하면 'Apple Inc., Class A' 같은 이름이 두 칸으로 갈라져
 * 그 뒤의 숫자가 전부 한 칸씩 밀린다. 엑셀에서 열면 PER 자리에 가격이
 * 들어가 있는데, 틀린 줄 모르고 쓰게 된다.
 *
 * 앞에 BOM 을 붙인다 — 없으면 엑셀이 한글을 깨뜨린다.
 */
export type CSV칸 = string | number | null | undefined;

export function csv칸(v: CSV칸): string {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv글(줄들: CSV칸[][]): string {
  return 줄들.map((줄) => 줄.map(csv칸).join(",")).join("\r\n");
}

export function csv내려받기(파일이름: string, 줄들: CSV칸[][]) {
  const blob = new Blob(["﻿" + csv글(줄들)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = 파일이름;
  a.click();
  URL.revokeObjectURL(url);
}
