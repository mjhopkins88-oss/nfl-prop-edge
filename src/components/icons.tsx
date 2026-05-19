// Small inline SVG icon set. Tailwind sizing via `className`.
// No external deps; tree-shakeable.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon(props: IconProps & { children: React.ReactNode }) {
  const { children, className, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function TrendUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </Icon>
  );
}

export function TrendDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <polyline points="3 7 9 13 13 9 21 17" />
      <polyline points="14 17 21 17 21 10" />
    </Icon>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
    </Icon>
  );
}

export function TargetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </Icon>
  );
}

export function AlertTriangleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4l9.5 16h-19z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </Icon>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />
    </Icon>
  );
}

export function ChartBarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="4" y1="20" x2="20" y2="20" />
      <rect x="5" y="10" width="3" height="8" rx="0.5" />
      <rect x="10.5" y="6" width="3" height="12" rx="0.5" />
      <rect x="16" y="13" width="3" height="5" rx="0.5" />
    </Icon>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5h16l-6 8v6l-4-2v-4z" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <polyline points="9 6 15 12 9 18" />
    </Icon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="20" y1="12" x2="4" y2="12" />
      <polyline points="10 6 4 12 10 18" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="8" r="0.6" fill="currentColor" />
    </Icon>
  );
}

export function ScalesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="6" y1="20" x2="18" y2="20" />
      <path d="M5 9l-3 6h6z" />
      <path d="M19 9l-3 6h6z" />
      <line x1="5" y1="9" x2="19" y2="9" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </Icon>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className ?? "h-8 w-8"}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="55%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#e76f51" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-grad)" />
      <path
        d="M7 22 L12 14 L16 19 L22 9"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="22" cy="9" r="1.6" fill="white" />
    </svg>
  );
}
