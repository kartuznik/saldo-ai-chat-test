import { useId } from "react";

type AvatarProps = {
  className?: string;
};

export function KuzmaMark({ className }: AvatarProps) {
  const uid = useId();
  const ring = `${uid}-ring`;
  const mark = `${uid}-fill`;
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={ring} x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 35%, var(--bg))" />
        </linearGradient>
        <linearGradient id={mark} x1="20" y1="6" x2="20" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 45%, var(--warn))" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="19" fill="var(--bg)" stroke={`url(#${ring})`} strokeWidth="2" />
      <path d="M12.5 18.5 16.2 6.8 20 17.2Z" fill={`url(#${mark})`} />
      <path d="M20 17.2 23.8 6.8 27.5 18.5Z" fill={`url(#${mark})`} />
      <path
        d="M12.2 19.2 20 14.6 27.8 19.2 25.4 26.6 20 31.2 14.6 26.6Z"
        fill={`url(#${mark})`}
      />
      <path d="M16.4 20.2 20 17.6 23.6 20.2 22.6 24.8 20 27.4 17.4 24.8Z" fill="var(--bg)" opacity="0.35" />
      <path
        d="M16 11.2 13.4 8.8M24 11.2 26.6 8.8M20 13.4V8.2"
        fill="none"
        stroke="var(--warn)"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function OwnerSilhouette({ className }: AvatarProps) {
  const uid = useId();
  const clip = `${uid}-clip`;
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="20" cy="20" r="20" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <circle cx="20" cy="20" r="20" fill="var(--surface)" />
        <ellipse cx="20" cy="14.5" rx="7.4" ry="8.6" fill="var(--accent)" />
        <ellipse cx="20" cy="36.5" rx="14.5" ry="11.5" fill="var(--accent)" />
      </g>
    </svg>
  );
}
