"use client";

import { useState, useEffect, useTransition } from "react";
import { format } from "date-fns";
import {
  Info,
  AlertTriangle,
  XCircle,
  Bug,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { useWorld } from "@/components/world-context";
import { ResourceTable, Column } from "@/components/resource-table";
import { listWorldLogs } from "@/app/actions";

export interface Log {
  id: string;
  worldId: string;
  timestamp: number;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  metadata: Record<string, unknown> | null;
}

export function WorldLogsContent() {
  const { world } = useWorld();
  const [logs, setLogs] = useState<Log[]>([]);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  const fetchLogs = async (currentLimit: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listWorldLogs(world.id, currentLimit);
      if (result.success && result.logs) {
        setLogs(result.logs);
      } else {
        setError(result.error || "Failed to fetch logs");
      }
    } catch (err) {
      setError("An unexpected error occurred while fetching logs");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(limit);
  }, [world.id, limit]);

  const handleRefresh = () => {
    startRefresh(() => {
      fetchLogs(limit);
    });
  };

  const columns: Column<Log>[] = [
    {
      key: "level",
      label: "Level",
      className: "w-24",
      render: (log) => {
        const icons = {
          info: <Info className="w-4 h-4 text-blue-500" />,
          warn: <AlertTriangle className="w-4 h-4 text-amber-500" />,
          error: <XCircle className="w-4 h-4 text-red-500" />,
          debug: <Bug className="w-4 h-4 text-stone-500" />,
        };
        return (
          <div className="flex items-center gap-2">
            {icons[log.level as keyof typeof icons] || (
              <Terminal className="w-4 h-4 text-stone-500" />
            )}
            <span className="capitalize text-xs font-medium">{log.level}</span>
          </div>
        );
      },
    },
    {
      key: "message",
      label: "Message",
      render: (log) => (
        <div className="max-w-xl">
          <p className="font-mono text-xs break-all">{log.message}</p>
          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <pre className="mt-1 text-[10px] text-stone-500 bg-stone-50 dark:bg-stone-950/50 p-2 rounded-md overflow-x-auto">
              {JSON.stringify(log.metadata, null, 2)}
            </pre>
          )}
        </div>
      ),
    },
    {
      key: "timestamp",
      label: "Timestamp",
      className: "w-48 text-right",
      render: (log) => (
        <span className="text-xs text-stone-500 tabular-nums">
          {format(log.timestamp, "MMM d, HH:mm:ss.SSS")}
        </span>
      ),
    },
  ];

  return (
    <main>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold tracking-tight text-stone-900 dark:text-white">
                Logs
              </h1>
            </div>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Recent activity and system events for this world.
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading || isRefreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-300 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-md hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${loading || isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/50 rounded-lg flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                Error Loading Logs
              </p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                {error}
              </p>
              <button
                onClick={() => fetchLogs(limit)}
                className="text-sm font-semibold text-red-800 dark:text-red-200 underline mt-2"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        <ResourceTable
          columns={columns}
          data={logs}
          loading={loading}
          emptyState={
            <div className="p-12 text-center">
              <Terminal className="w-12 h-12 text-stone-300 dark:text-stone-700 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-stone-900 dark:text-white">
                No logs found
              </h3>
              <p className="text-sm text-stone-500 dark:text-stone-400 mt-1 text-balance">
                Activities like searching, querying, or updating your world will
                appear here.
              </p>
            </div>
          }
          pagination={{
            pageSize: limit,
            hasMore: false, // API doesn't support pagination yet
            onPageChange: () => {},
            onPageSizeChange: (size) => setLimit(size),
          }}
        />
      </div>
    </main>
  );
}
