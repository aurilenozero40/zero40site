import { cn } from "@/lib/utils";

function DtudoEmblem({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 220"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <clipPath id="dtudo-emblem-clip">
          <circle cx="110" cy="110" r="90" />
        </clipPath>
        <linearGradient id="dtudo-blue" x1="0" y1="18" x2="0" y2="79.33" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6EC0EE" />
          <stop offset="1" stopColor="#2E75B6" />
        </linearGradient>
        <linearGradient id="dtudo-green" x1="0" y1="79.33" x2="0" y2="140.67" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8DD35F" />
          <stop offset="1" stopColor="#3D8B37" />
        </linearGradient>
        <linearGradient id="dtudo-yellow" x1="0" y1="140.67" x2="0" y2="202" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFDA6A" />
          <stop offset="1" stopColor="#F2994A" />
        </linearGradient>
      </defs>

      <circle cx="110" cy="110" r="100" fill="none" stroke="currentColor" strokeWidth="8" />

      <g clipPath="url(#dtudo-emblem-clip)">
        <rect x="18" y="18" width="184" height="61.33" fill="url(#dtudo-blue)" />
        <rect x="18" y="79.33" width="184" height="61.34" fill="url(#dtudo-green)" />
        <rect x="18" y="140.67" width="184" height="61.33" fill="url(#dtudo-yellow)" />

        <g transform="translate(110,110)">
          <g fill="#1B4F72">
            <circle cx="-45" cy="-64" r="9" />
            <path d="M -50,-59 C -32,-73 8,-74 34,-58 C 8,-49 -30,-49 -50,-59 Z" />
            <path d="M 30,-61 C 45,-71 60,-69 68,-57 L 59,-51 C 49,-59 39,-57 31,-53 Z" />
          </g>
          <g stroke="#1B4F72" strokeWidth="3" fill="none" strokeLinecap="round">
            <path d="M -22,-38 Q -12,-33 -2,-38" />
            <path d="M 8,-36 Q 18,-31 28,-36" />
          </g>
          <g stroke="#1E5631" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="-40" cy="18" r="15" />
            <circle cx="42" cy="18" r="15" />
            <path d="M -40,18 L -5,-14 L 42,18 M -5,-14 L 8,18" />
            <path d="M -5,-14 C 6,-29 20,-31 29,-24" />
            <path d="M 24,-21 L 39,9" />
          </g>
          <circle cx="33" cy="-29" r="8" fill="#1E5631" />
          <g fill="#B34700">
            <circle cx="-14" cy="32" r="9" />
          </g>
          <g stroke="#B34700" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M -14,41 L 6,60" />
            <path d="M 6,60 L 23,54 L 34,68" />
            <path d="M 6,60 L -11,73 L -24,86" />
            <path d="M -6,46 L 12,39" />
            <path d="M -6,46 L -23,56" />
          </g>
        </g>
      </g>
    </svg>
  );
}

export function Logo({
  showSubtitle = false,
  size = "md",
  className,
}: {
  showSubtitle?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const iconSize = size === "lg" ? "h-14 w-14" : size === "sm" ? "h-6 w-6" : "h-9 w-9";
  const textSize = size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-lg";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <DtudoEmblem className={cn(iconSize, "shrink-0")} />
      <div className="flex flex-col">
        <span className={cn("font-extrabold uppercase leading-none tracking-tight", textSize)}>
          Dtudo
        </span>
        {showSubtitle && (
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] opacity-70">
            GPS e acessórios
          </span>
        )}
      </div>
    </div>
  );
}
