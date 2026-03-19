import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useToastNotifications } from "./hooks/useToastNotifications";
import ChatPanel from "./components/ChatPanel";
import DataSidebar from "./components/DataSidebar";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import ToastProvider from "./components/ToastProvider";

export default function App() {
  const { connected, messages, notifications, status, timers, positions, wallet, candidates, sendMessage } = useWebSocket();
  const [cmdOpen, setCmdOpen] = useState(false);

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
    <div className="h-screen flex flex-col">
      <StatusBar connected={connected} status={status} timers={timers} wallet={wallet} />

      <div className="flex flex-1 overflow-hidden">
        {/* Chat panel */}
        <div className="flex-[55] border-r border-teal/30 flex flex-col">
          <ChatPanel
            messages={messages}
            status={status}
            onSend={sendMessage}
            onOpenCommandPalette={() => setCmdOpen(true)}
          />
        </div>

        {/* Data Sidebar */}
        <div className="flex-[45] flex flex-col overflow-hidden">
          <DataSidebar
            positions={positions}
            wallet={wallet}
            candidates={candidates}
            notifications={notifications}
            status={status}
          />
        </div>
      </div>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} onExecute={handleCommandExecute} />
      <ToastProvider />
    </div>
  );
}
