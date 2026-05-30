import { Card, ChangeBadge } from "@/components/ui";

interface IndexCardProps {
  name: string;
  value: number;
  change: number;
  change_rate: number;
}

export function IndexCard({ name, value, change, change_rate }: IndexCardProps) {
  const isPos = change_rate >= 0;

  return (
    <Card className="flex flex-col gap-1 min-w-[160px]">
      <span className="text-text-secondary text-xs font-medium tracking-wider uppercase">{name}</span>
      <span className="text-text-primary text-2xl font-mono font-semibold">
        {value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}
      </span>
      <div className="flex items-center gap-2">
        <ChangeBadge value={change_rate} />
        <span className={`text-xs font-mono ${isPos ? "text-accent-green" : "text-accent-red"}`}>
          ({isPos ? "+" : ""}{change.toLocaleString("ko-KR", { maximumFractionDigits: 2 })})
        </span>
      </div>
    </Card>
  );
}
