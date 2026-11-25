import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface Column<Row> {
  /** Stable key for React. */
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

interface DataTableProps<Row> {
  /** Visible caption (also the accessible name). */
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  getRowKey: (row: Row) => string;
  /** Rendered instead of the table when there are no rows. */
  empty?: ReactNode;
  className?: string;
}

/** Semantic, horizontally scrollable table. Rows always come from the API, never from sample data. */
export function DataTable<Row>({ caption, columns, rows, getRowKey, empty, className }: DataTableProps<Row>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;

  return (
    <div className={cn('overflow-x-auto rounded-(--radius-card) border border-line bg-surface-raised', className)}>
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="px-4 pt-4 pb-2 text-left font-display text-base font-semibold">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-ink-muted">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-4 py-3 font-medium',
                  column.align === 'right' ? 'text-right' : 'text-left',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="border-b border-line last:border-b-0 hover:bg-surface-sunken/60">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn('px-4 py-3', column.align === 'right' ? 'text-right tabular-nums' : 'text-left', column.className)}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
