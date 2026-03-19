import { useMemo } from "react";
import type { PositionData, WalletData, LpOverviewData } from "../hooks/useWebSocket";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import PositionCard from "./PositionCard";

interface DashboardTabProps {
  positions: PositionData | null;
  wallet: WalletData | null;
  lpOverview: LpOverviewData | null;
}

export default function DashboardTab({ positions, wallet, lpOverview }: DashboardTabProps) {
  const oorCount = useMemo(
    () => positions?.positions.filter((p) => !p.in_range).length ?? 0,
    [positions],
  );

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Wallet Card */}
        <Card>
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
          </CardHeader>
          <CardContent>
            {wallet ? (
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-lg text-cream font-medium">
                  {wallet.sol.toFixed(3)} <span className="text-ash text-xs">SOL</span>
                </span>
                <span className="font-mono text-sm text-steel">
                  ${wallet.sol_usd.toFixed(2)}
                </span>
                <span className="font-mono text-[10px] text-ash/60 ml-auto">
                  SOL ${wallet.sol_price.toFixed(2)}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* LP Performance Card */}
        <Card>
          <CardHeader>
            <CardTitle>LP Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {lpOverview ? (
              <div className="space-y-2 font-mono text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-ash">Total PnL</span>
                  <span className={lpOverview.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {lpOverview.total_pnl >= 0 ? "+" : ""}{lpOverview.total_pnl_sol.toFixed(4)} SOL
                    <span className="text-ash/60 ml-1">(${lpOverview.total_pnl_usd.toFixed(2)})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ash">Total Fees</span>
                  <span className="text-cream">
                    {lpOverview.total_fees_sol.toFixed(4)} SOL
                    <span className="text-ash/60 ml-1">(${lpOverview.total_fees_usd.toFixed(2)})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ash">Win Rate</span>
                  <span className="text-cream">{lpOverview.win_rate_pct.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ash">Closed Positions</span>
                  <span className="text-cream">{lpOverview.closed_positions}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ash">Avg Hold Time</span>
                  <span className="text-cream">{lpOverview.avg_hold_hours.toFixed(1)}h</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ash">ROI</span>
                  <span className={lpOverview.roi_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {lpOverview.roi_pct >= 0 ? "+" : ""}{lpOverview.roi_pct.toFixed(2)}%
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* OOR Alert */}
        {oorCount > 0 && (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-400 font-mono">
            {oorCount} position{oorCount > 1 ? "s" : ""} out of range
          </div>
        )}

        {/* Positions */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ash">
              Positions
            </span>
            {positions && (
              <span className="font-mono text-[10px] text-ash/60">
                {positions.total_positions} open
              </span>
            )}
          </div>

          {positions ? (
            positions.positions.length > 0 ? (
              <div className="space-y-2">
                {positions.positions.map((p) => (
                  <PositionCard key={p.position} position={p} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-ash/40 text-sm">
                No open positions
              </div>
            )
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
