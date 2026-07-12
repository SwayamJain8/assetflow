"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { useState } from "react";

import { Button } from "./button";
import { cn } from "@/lib/utils";

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="h-10 bg-surface-2 border-b border-line" />
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-4 px-4 py-3 border-b border-line last:border-0">
          {Array.from({ length: cols }).map((_, col) => (
            <div
              key={col}
              className="skeleton h-4"
              style={{ width: col === 0 ? "12%" : `${100 / cols}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ElementType;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="rounded-full bg-surface-2 p-3.5 mb-3.5 border border-line">
        <Icon className="size-5 text-subtle" />
      </div>
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {description && <p className="text-xs text-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * The table used on eight of the ten screens.
 *
 * Sorting, pagination, an empty state and a loading skeleton live here once, so a
 * screen is a column definition and nothing more. That is what makes the rest of
 * the frontend assembly rather than construction.
 */
export function DataTable<T>({
  data,
  columns,
  isLoading,
  onRowClick,
  empty,
  pageSize = 12,
  className,
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  isLoading?: boolean;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  pageSize?: number;
  className?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  if (isLoading) return <TableSkeleton cols={columns.length} />;

  if (!data.length) {
    return (
      <div className="card">
        {empty ?? <EmptyState title="Nothing here yet" description="Records will appear here." />}
      </div>
    );
  }

  const pageCount = table.getPageCount();

  return (
    <div className={cn("card overflow-hidden", className)}>
      {/* Wide tables scroll inside their own box; the page body never scrolls sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 border-b border-line">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sortable = header.column.getCanSort();

                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        "px-4 py-2.5 text-left text-xs font-medium text-muted whitespace-nowrap",
                        sortable && "cursor-pointer select-none hover:text-fg transition-colors",
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortable && (
                          <ArrowUpDown
                            className={cn(
                              "size-3 transition-opacity",
                              header.column.getIsSorted() ? "opacity-100 text-primary" : "opacity-25",
                            )}
                          />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
                className={cn(
                  "border-b border-line last:border-0 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-surface-2",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2.5 text-fg">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-line bg-surface-2">
          <p className="text-xs text-muted nums">
            {table.getState().pagination.pageIndex * pageSize + 1}–
            {Math.min((table.getState().pagination.pageIndex + 1) * pageSize, data.length)} of{" "}
            {data.length}
          </p>

          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
