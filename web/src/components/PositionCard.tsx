import { memo } from "react";
import type { PositionInfo } from "../hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hrs < 24) return `${hrs}h ${remainMins}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function PositionCardInner({ position }: { position: PositionInfo }) {
  const { pair, in_range, pnl_pct, unclaimed_fees_sol, unclaimed_fees_usd, age_seconds, active_bin, lower_bin, upper_bin } = position;

  const binRange = upper_bin - lower_bin;
  const binProgress = binRange > 0 ? ((active_bin - lower_bin) / binRange) * 100 : 50;
  const pnlColor = pnl_pct >= 0 ? "text-emerald-400" : "text-red-400";
  const fees = unclaimed_fees_sol != null ? `${unclaimed_fees_sol.toFixed(4)} SOL` : unclaimed_fees_usd != null ? `$${unclaimed_fees_usd.toFixed(2)}` : "--";

  return (
    <div className={`rounded-lg border bg-teal/15 p-3 text-xs transition-all hover:bg-teal/25 ${in_range ? "border-l-2 border-l-emerald-400 border-steel/20" : "border-l-2 border-l-red-400 border-steel/20"}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[12px] text-cream font-medium">{pair}</span>
        <Badge variant={in_range ? "outline" : "destructive"}>
          {in_range ? "IN RANGE" : "OOR"}
        </Badge>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 mb-2">
        <div>
          <span className="text-ash text-[10px] block">PnL</span>
          <span className={`font-mono text-[11px] font-medium ${pnlColor}`}>
            {pnl_pct >= 0 ? "+" : ""}{pnl_pct.toFixed(2)}%
          </span>
        </div>
        <div>
          <span className="text-ash text-[10px] block">Fees</span>
          <span className="font-mono text-[11px] text-cream">{fees}</span>
        </div>
        <div className="ml-auto">
          <span className="text-ash text-[10px] block">Age</span>
          <span className="font-mono text-[11px] text-steel">{formatAge(age_seconds)}</span>
        </div>
      </div>

      {/* Bin range */}
      <div>
        <div className="flex justify-between mb-0.5">
          <span className="font-mono text-[9px] text-ash/60">{lower_bin}</span>
          <span className="font-mono text-[9px] text-ash/60">{upper_bin}</span>
        </div>
        <Progress
          value={binProgress}
          indicatorClassName={in_range ? "bg-emerald-400/70" : "bg-red-400/70"}
        />
      </div>
    </div>
  );
}

const PositionCard = memo(PositionCardInner, (prev, next) =>
  prev.position.pnl_pct === next.position.pnl_pct &&
  prev.position.in_range === next.position.in_range &&
  prev.position.unclaimed_fees_sol === next.position.unclaimed_fees_sol
);

export default PositionCard;
