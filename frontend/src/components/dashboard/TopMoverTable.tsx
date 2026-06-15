import { ChangeBadge } from "@/components/ui";

interface MoverItem {
  mksc_shrn_iscd?: string;
  hts_kor_isnm?: string;
  stck_prpr?: string;
  prdy_ctrt?: string;
  acml_vol?: string;
}

interface Props {
  title: string;
  items: MoverItem[];
  type: "rise" | "fall";
}

export function TopMoverTable({ title, items, type }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className={`text-sm font-semibold ${type === "rise" ? "text-accent-green" : "text-accent-red"}`}>
        {title}
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-text-muted text-xs border-b border-border">
            <th className="text-left pb-1">종목</th>
            <th className="text-right pb-1">현재가</th>
            <th className="text-right pb-1">등락률</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.mksc_shrn_iscd || i} className="border-b border-border/40 hover:bg-bg-hover transition-colors">
              <td className="py-1.5 text-text-primary font-medium">
                {item.hts_kor_isnm || item.mksc_shrn_iscd}
              </td>
              <td className="py-1.5 text-right font-mono text-text-primary">
                {Number(item.stck_prpr || 0).toLocaleString("ko-KR")}
              </td>
              <td className="py-1.5 text-right">
                <ChangeBadge value={Number(item.prdy_ctrt || 0)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
