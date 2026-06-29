import { Card, ChangeBadge } from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";

interface IndexCardProps {
  name: string;
  value: number;
  change: number;
  change_rate: number;
}

export function IndexCard({ name, value, change, change_rate }: IndexCardProps) {
  const colorScheme = useSettingsStore((s) => s.colorScheme);
  const isPos = change_rate >= 0;
  const changeColor = isPos
    ? (colorScheme === "red-blue" ? "text-accent-red" : "text-accent-green")
    : (colorScheme === "red-blue" ? "text-accent-blue" : "text-accent-red");

  return (
    <Card className="flex flex-col gap-1 min-w-[160px]">
      <span className="text-text-secondary text-xs font-medium tracking-wider uppercase">{name}</span>
      <span className="text-text-primary text-2xl font-mono font-semibold">
        {value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}
      </span>
      <div className="flex items-center gap-2">
        <ChangeBadge value={change_rate} />
        <span className={`text-xs font-mono ${changeColor}`}>
          ({isPos ? "+" : ""}{change.toLocaleString("ko-KR", { maximumFractionDigits: 2 })})
        </span>
      </div>
    </Card>
  );
}
