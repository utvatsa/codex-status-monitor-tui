// A tiny inline icon set (stroke icons on a 16px grid). Inline SVG needs no icon font, no extra request,
// and picks up the text colour through `currentColor`.
const PATHS = {
  refresh: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5h-1v-8h8v1",
  check: "M3.5 8.5l3 3 6-7",
  chevron: "M4 6l4 4 4-4",
  search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.5 10.5L14 14",
  keyboard: "M1.5 4.5h13v8h-13zM4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 10h6",
  theme: "M8 2.5a5.5 5.5 0 1 0 0 11zM8 2.5a5.5 5.5 0 0 1 0 11",
  close: "M4 4l8 8M12 4l-8 8",
  alert: "M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5h.01",
  terminal: "M2.5 3.5h11v9h-11zM5 7l2 1.5L5 10M8.5 10.5h2.5",
  folder: "M2 4.5h4l1.5 1.5H14v6.5H2z",
  cpu: "M4.5 4.5h7v7h-7zM6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14",
  coin: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM9.8 6.2C9.4 5.5 8.8 5.2 8 5.2c-1 0-1.8.5-1.8 1.3 0 1.9 3.7.9 3.7 2.9 0 .8-.8 1.4-1.9 1.4-.9 0-1.6-.4-2-1.1M8 4v1.2M8 10.8V12",
  gauge: "M2.5 11a5.5 5.5 0 1 1 11 0M8 11l3-3.5",
  chat: "M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z",
  archive: "M2 3h12v3H2zM3 6v7h10V6M6.5 8.5h3",
  plug: "M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3",
  back: "M10 4L6 8l4 4",
  server: "M2.5 2.5h11v4h-11zM2.5 9.5h11v4h-11zM5 4.5h.01M5 11.5h.01M8 4.5h3M8 11.5h3",
  disk: "M2.5 5c0-1.1 2.5-2 5.5-2s5.5.9 5.5 2-2.5 2-5.5 2-5.5-.9-5.5-2zM2.5 5v6c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V5",
  info: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v3.5M8 5h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
