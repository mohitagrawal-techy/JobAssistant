import { useId } from "react";

/** The K mark: a violet stem and leg, an amber sweep, a gateway arch cut below it, and a star. */
export function LogoMark({ className = "" }: { className?: string }) {
  const id = useId().replace(/\W/g, "");
  return (
    <svg viewBox="70 25 770 820" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}stem`} x1="140" y1="170" x2="340" y2="520" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#4c1d95" />
        </linearGradient>
        <linearGradient id={`${id}leg`} x1="330" y1="540" x2="640" y2="840" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4c1d95" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id={`${id}sweep`} x1="640" y1="250" x2="170" y2="640" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fba524" />
          <stop offset="0.65" stopColor="#f98a2c" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id={`${id}foot`} x1="130" y1="600" x2="130" y2="830" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5a1a7a" />
          <stop offset="1" stopColor="#f9921e" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id}stem)`}
        d="M80 640V305C80 225 145 162 225 162H335Q355 162 355 182V420Z"
      />
      <path
        fill={`url(#${id}leg)`}
        d="M265 575C290 550 340 530 390 522C450 520 500 560 540 605L722 815Q735 837 710 837H450C400 837 378 815 378 780V715L355 712V688L325 665L322 640L285 620Z"
      />
      <path
        fill={`url(#${id}foot)`}
        d="M80 700C115 650 170 610 235 580L265 575L258 600L235 625L205 640V660L172 675L170 708L150 715V815Q150 837 130 837H95Q80 837 80 820Z"
      />
      <path
        fill={`url(#${id}sweep)`}
        d="M80 625C190 500 300 420 440 300C510 245 570 238 680 238C620 340 540 470 430 515C390 530 300 540 220 585C170 610 115 650 80 705Z"
      />
      <path
        fill="#f59e0b"
        d="M722 33C730 110 745 140 830 153C745 165 730 195 722 273C714 195 698 165 612 153C698 140 714 110 722 33Z"
      />
    </svg>
  );
}

export function Logo({
  className = "",
  markClassName = "h-9 w-auto",
  wordClassName = "",
}: {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 font-sans font-extrabold uppercase tracking-tight ${className}`}>
      <LogoMark className={markClassName} />
      <span className={wordClassName}>Khoj</span>
    </span>
  );
}
