import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useToastNotifications } from "./hooks/useToastNotifications";
import ChatPanel from "./components/ChatPanel";
import DataSidebar from "./components/DataSidebar";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import KnowledgeGraph from "./components/KnowledgeGraph";
import ToastProvider from "./components/ToastProvider";

export default function App() {
  const { connected, messages, notifications, status, timers, positions, wallet, candidates, lpOverview, sendMessage, sendQuickAction, quickActionResult, clearQuickActionResult } = useWebSocket();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);

  useToastNotifications(notifications);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleCommandExecute = useCallback((command: string) => {
    sendMessage(command);
  }, [sendMessage]);

  return (
    <div className="flex min-h-screen flex-col bg-transparent">
      <StatusBar connected={connected} status={status} timers={timers} wallet={wallet} onOpenGraph={() => setGraphOpen(true)} />

      <div className="relative flex flex-1 flex-col lg:flex-row" style={{ height: "calc(100vh - 40px)", overflow: "hidden" }}>
        {/* Chat panel */}
        <div className="flex flex-col border-b border-white/8 bg-[linear-gradient(180deg,rgba(2,24,33,0.72),rgba(0,15,20,0.82))] lg:flex-[1.08] lg:border-b-0 lg:border-r" style={{ minHeight: 0 }}>
          <ChatPanel
            messages={messages}
            status={status}
            timers={timers}
            positions={positions}
            candidates={candidates}
            onSend={sendMessage}
            onOpenCommandPalette={() => setCmdOpen(true)}
          />
        </div>

        {/* Data Sidebar */}
        <div className="flex flex-col overflow-y-auto bg-[linear-gradient(180deg,rgba(8,31,40,0.54),rgba(0,15,20,0.72))] lg:flex-[0.92]" style={{ minHeight: 0 }}>
          <DataSidebar
            positions={positions}
            wallet={wallet}
            candidates={candidates}
            notifications={notifications}
            status={status}
            lpOverview={lpOverview}
            onCommand={sendMessage}
            sendQuickAction={sendQuickAction}
            quickActionResult={quickActionResult}
            clearQuickActionResult={clearQuickActionResult}
          />
        </div>
      </div>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} onExecute={handleCommandExecute} />
      <KnowledgeGraph open={graphOpen} onClose={() => setGraphOpen(false)} sendQuickAction={sendQuickAction} quickActionResult={quickActionResult} clearQuickActionResult={clearQuickActionResult} />
      <ToastProvider />
    </div>
  );
}
