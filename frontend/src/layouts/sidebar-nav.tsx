import { NavLink } from 'react-router';
import type { NavGroup } from '../app/navigation';
import { Icon } from '../components/ui/icon';
import { cn } from '../lib/cn';

interface SidebarNavProps {
  groups: readonly NavGroup[];
  /** Accessible name of the <nav> landmark. */
  label: string;
  onNavigate?: () => void;
}

/** Vertical navigation list. The active link gets aria-current="page" (set by NavLink). */
export function SidebarNav({ groups, label, onNavigate }: SidebarNavProps) {
  return (
    <nav aria-label={label} className="space-y-6">
      {groups.map((group, index) => (
        <div key={group.label ?? `group-${String(index)}`}>
          {group.label ? (
            <p className="mb-2 px-3 text-xs font-semibold tracking-wider text-ink-muted uppercase">{group.label}</p>
          ) : null}
          <ul className="space-y-1">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end === true}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-200',
                      isActive
                        ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-100'
                        : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                    )
                  }
                >
                  <Icon
                    name={item.icon}
                    className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                  />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
