import { cn } from '../../lib/cn';

/**
 * Small inline SVG icon set (decision U4: no icon dependency). 24x24, stroke-based, inherits currentColor.
 * Icons are decorative (aria-hidden); always pair them with visible text or an aria-label on the control.
 */
const PATHS = {
  dashboard: 'M4 13h6V4H4zm0 7h6v-4H4zm10 0h6v-9h-6zm0-16v4h6V4z',
  menuBook: 'M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zm0 16V5m4 2h6m-6 4h6',
  orders: 'M8 4h8m-8 0a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2M9 10h6m-6 4h6m-6 4h3',
  inventory: 'M3 7l9-4 9 4-9 4zm0 0v10l9 4 9-4V7m-9 4v10',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4m5-1v5l3 2',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 21h15.8a2 2 0 0 0 1.7-3.4L13.7 3.9a2 2 0 0 0-3.4 0',
  table: 'M4 8h16M6 8v11m12-11v11M4 8l2-4h12l2 4',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1m7-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6m13 9v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zm3 5h6m-6 4h6m-6 4h3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6m7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.2-1.3L14.3 2h-4l-.4 2.5a7 7 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.2 1.3l.4 2.5h4l.4-2.5a7 7 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3',
  user: 'M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  flame: 'M12 21a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8a7 7 0 0 0 7 7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18m0-14v5l3 2',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18m-4-9 3 3 5-6',
  tray: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
  cart: 'M3 4h2l2.4 11h10.8L21 7H6.2M9 20h.01M18 20h.01',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h10v12H9zM5 15V3h10',
  edit: 'M4 20h4L19 9l-4-4L4 16zm9-13 4 4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  check: 'M5 12l5 5 9-10',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4m-4 4h11',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18m0-11v6m0-9h.01',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('size-5 shrink-0', className)}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
