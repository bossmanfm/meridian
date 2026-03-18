import { Wifi, WifiOff } from "lucide-react";
import type { StatusInfo, TimerInfo } from "../hooks/useWebSocket";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface StatusBarProps {
  connected: boolean;
  status: StatusInfo;
  timers: TimerInfo;
}

export default function StatusBar({ connected, status, timers }: StatusBarProps) {
  const busyLabel = status.managementBusy
    ? "Managing"
    : status.screeningBusy
      ? "Screening"
      : "Working";

  const busyTooltip = [
    status.managementBusy && "Management cycle active",
    status.screeningBusy && "Screening cycle active",
    status.busy && !status.managementBusy && !status.screeningBusy && "Agent is working",
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-4 px-4 py-2.5 border-b border-teal/30 bg-teal/60 backdrop-blur-sm text-xs">
        {/* Connection */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              {connected ? (
                <Wifi size={14} className="text-steel" />
              ) : (
                <WifiOff size={14} className="text-cream/50" />
              )}
              <span className={connected ? "text-steel" : "text-cream/50"}>
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>WebSocket connection to DLMM agent</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-3" />

        {/* Timers */}
        <div className="flex items-center gap-3 text-ash">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono text-[11px] uppercase">
                MGT:{" "}
                {timers.management === "--" ? (
                  <Skeleton className="h-3 w-8 inline-block" />
                ) : (
                  <span className="text-cream">{timers.management}</span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>Time until next management cycle</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono text-[11px] uppercase">
                SCR:{" "}
                {timers.screening === "--" ? (
                  <Skeleton className="h-3 w-8 inline-block" />
                ) : (
                  <span className="text-cream">{timers.screening}</span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>Time until next screening cycle</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1" />

        {/* Busy indicator */}
        {(status.busy || status.managementBusy || status.screeningBusy) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-steel animate-subtle-glow" />
                <span className="font-mono text-[11px] text-steel">{busyLabel}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>{busyTooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
