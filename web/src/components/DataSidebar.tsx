import type { PositionData, WalletData, CandidateData, Notification, StatusInfo, LpOverviewData } from "../hooks/useWebSocket";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import DashboardTab from "./DashboardTab";
import CandidatesTab from "./CandidatesTab";
import ActivityTab from "./ActivityTab";

interface DataSidebarProps {
  positions: PositionData | null;
  wallet: WalletData | null;
  candidates: CandidateData | null;
  notifications: Notification[];
  status: StatusInfo;
  lpOverview: LpOverviewData | null;
}

export default function DataSidebar({ positions, wallet, candidates, notifications, lpOverview }: DataSidebarProps) {
  return (
    <Tabs defaultValue="dashboard" className="flex flex-col h-full">
      <TabsList>
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="candidates">Candidates</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard" className="flex-1">
        <DashboardTab positions={positions} wallet={wallet} lpOverview={lpOverview} />
      </TabsContent>

      <TabsContent value="candidates" className="flex-1">
        <CandidatesTab candidates={candidates} />
      </TabsContent>

      <TabsContent value="activity" className="flex-1">
        <ActivityTab notifications={notifications} />
      </TabsContent>
    </Tabs>
  );
}
