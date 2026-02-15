"use client";

import { Search, Database, List, Trash2, PlusCircle } from "lucide-react";

export interface SuggestedQuery {
  id: string;
  label: string;
  query: string;
  icon: React.ReactNode;
  description: string;
}

const SUGGESTED_QUERIES: SuggestedQuery[] = [
  {
    id: "list-all",
    label: "List All Triples",
    description: "Get the first 100 triples from the world.",
    icon: <List className="w-4 h-4" />,
    query: `SELECT ?subject ?predicate ?object
WHERE {
  ?subject ?predicate ?object .
}
LIMIT 100`,
  },
  {
    id: "count-all",
    label: "Count All Triples",
    description: "Total number of triples stored in this world.",
    icon: <Database className="w-4 h-4" />,
    query: `SELECT (COUNT(*) as ?count)
WHERE {
  ?subject ?predicate ?object .
}`,
  },
  {
    id: "insert-example",
    label: "Insert Example Data",
    description: "Add sample Person data (Alice) to the world.",
    icon: <PlusCircle className="w-4 h-4" />,
    query: `PREFIX ex: <http://example.org/>

INSERT DATA {
  ex:alice a ex:Person ;
    ex:name "Alice" ;
    ex:age 30 .
}`,
  },
  {
    id: "delete-all",
    label: "Delete All Triples",
    description: "Careful! This will remove all data from the world.",
    icon: <Trash2 className="w-4 h-4" />,
    query: `DELETE WHERE {
  ?s ?p ?o .
}`,
  },
  {
    id: "find-predicates",
    label: "Find Unique Predicates",
    description: "List all unique properties used in the world.",
    icon: <Search className="w-4 h-4" />,
    query: `SELECT DISTINCT ?p WHERE {
  ?s ?p ?o
} LIMIT 50`,
  },
];

export function SuggestedQueries({
  onSelect,
}: {
  onSelect: (query: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {SUGGESTED_QUERIES.map((sq) => (
        <button
          key={sq.id}
          onClick={() => onSelect(sq.query)}
          className="flex items-center gap-3 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 hover:border-amber-500/50 hover:bg-amber-50/50 dark:hover:bg-amber-950/10 transition-all text-left group"
        >
          <div className="p-2 rounded-lg bg-stone-100 dark:bg-stone-900 text-stone-500 dark:text-stone-400 group-hover:text-amber-600 dark:group-hover:text-amber-500 transition-colors shrink-0">
            {sq.icon}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
              {sq.label}
            </div>
            <div className="text-[10px] text-stone-500 dark:text-stone-400 truncate">
              {sq.description}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
