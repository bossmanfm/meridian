import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useToastNotifications } from "./hooks/useToastNotifications";
import ChatPanel from "./components/ChatPanel";
import NotificationFeed from "./components/NotificationFeed";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import ToastProvider from "./components/ToastProvider";

export default function App() {
  const { connected, messages, notifications, status, timers, sendMessage } = useWebSocket();
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
      <StatusBar connected={connected} status={status} timers={timers} />

      <div className="flex flex-1 overflow-hidden">
        {/* Chat panel */}
        <div className="flex-[65] border-r border-teal/30 flex flex-col">
          <ChatPanel
            messages={messages}
            status={status}
            onSend={sendMessage}
            onOpenCommandPalette={() => setCmdOpen(true)}
          />
        </div>

        {/* Sidebar */}
        <div className="flex-[35] flex flex-col">
          <div className="px-4 py-2.5 border-b border-teal/30 font-mono text-ash uppercase tracking-wider text-[11px]">
            Notifications
          </div>
          <div className="flex-1 overflow-hidden">
            <NotificationFeed notifications={notifications} />
          </div>
        </div>
      </div>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} onExecute={handleCommandExecute} />
      <ToastProvider />
    </div>
  );
}
