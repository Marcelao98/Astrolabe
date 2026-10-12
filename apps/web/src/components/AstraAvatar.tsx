export type AstraMood = "neutral" | "happy" | "search" | "alert" | "think";

interface Props {
  mood?: AstraMood;
  size?: number;
  className?: string;
}

/**
 * Astra — personagem ORIGINAL: robô-garota de estilo anime, com trancinhas de fibra óptica
 * e uma antena em forma de astrolábio. Arte provisória, feita à mão em SVG (será refinada).
 */
export function AstraAvatar({ mood = "neutral", size = 120, className }: Props) {
  const look = mood === "search" ? { x: 5, y: -1 } : mood === "think" ? { x: -4, y: -5 } : { x: 0, y: 0 };
  const big = mood === "alert" ? 1.12 : 1;
  return (
    <svg
      className={`astra ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label={`Astra, a robô assistente (${mood})`}
    >
      <defs>
        <linearGradient id="as-hair" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c6cff" />
          <stop offset="0.6" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id="as-hair-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4c3fd1" />
          <stop offset="1" stopColor="#7c6cff" />
        </linearGradient>
        <linearGradient id="as-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7f9ff" />
          <stop offset="1" stopColor="#d8e2ff" />
        </linearGradient>
        <radialGradient id="as-iris" cx="0.5" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#c7f9ff" />
          <stop offset="0.45" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#6d28d9" />
        </radialGradient>
        <radialGradient id="as-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#8be9ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#8be9ff" stopOpacity="0" />
        </radialGradient>
        <clipPath id="as-eye-l">
          <ellipse cx="76" cy="104" rx={13 * big} ry={16 * big} />
        </clipPath>
        <clipPath id="as-eye-r">
          <ellipse cx="124" cy="104" rx={13 * big} ry={16 * big} />
        </clipPath>
      </defs>

      <g className="astra-float">
        {/* tranças de fibra óptica */}
        <g className="astra-tails">
          <path d="M52 70 C 20 84, 12 128, 26 168 C 34 150, 46 140, 54 118 Z" fill="url(#as-hair)" />
          <path d="M148 70 C 180 84, 188 128, 174 168 C 166 150, 154 140, 146 118 Z" fill="url(#as-hair)" />
          <circle className="astra-tip" cx="26" cy="170" r="5.5" fill="#8be9ff" />
          <circle className="astra-tip" cx="174" cy="170" r="5.5" fill="#8be9ff" />
          <circle cx="26" cy="170" r="12" fill="url(#as-glow)" />
          <circle cx="174" cy="170" r="12" fill="url(#as-glow)" />
        </g>

        {/* cabelo de trás */}
        <path d="M48 96 C 40 40, 78 22, 100 22 C 122 22, 160 40, 152 96 C 150 70, 130 52, 100 52 C 70 52, 50 70, 48 96 Z" fill="url(#as-hair-dark)" />

        {/* pescoço e colarinho */}
        <rect x="88" y="146" width="24" height="16" rx="6" fill="#b8c6f5" />
        <path d="M60 196 C 62 168, 82 160, 100 160 C 118 160, 138 168, 140 196 Z" fill="#26307a" />
        <path d="M82 164 L100 178 L118 164" fill="none" stroke="#8be9ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="100" cy="184" r="5" fill="#8be9ff" className="astra-core" />

        {/* orelhas-fone */}
        <g>
          <circle cx="46" cy="108" r="14" fill="#2b3680" />
          <circle cx="46" cy="108" r="9" fill="none" stroke="#8be9ff" strokeWidth="2.4" className="astra-core" />
          <circle cx="154" cy="108" r="14" fill="#2b3680" />
          <circle cx="154" cy="108" r="9" fill="none" stroke="#8be9ff" strokeWidth="2.4" className="astra-core" />
        </g>

        {/* rosto */}
        <path d="M50 100 C 50 62, 74 48, 100 48 C 126 48, 150 62, 150 100 C 150 132, 126 152, 100 152 C 74 152, 50 132, 50 100 Z" fill="url(#as-skin)" />
        <path d="M60 128 C 72 146, 128 146, 140 128" fill="none" stroke="#c3cfee" strokeWidth="2" opacity="0.6" />

        {/* franja */}
        <path d="M46 96 C 44 54, 76 34, 100 34 C 124 34, 156 54, 154 96 C 146 78, 134 66, 116 62 C 120 74, 112 82, 104 84 C 100 72, 88 64, 70 66 C 58 70, 50 82, 46 96 Z" fill="url(#as-hair)" />
        <path d="M100 34 C 98 52, 92 62, 86 70" fill="none" stroke="#e0e7ff" strokeWidth="1.6" opacity="0.5" />

        {/* antena-astrolábio */}
        <g>
          <line x1="100" y1="36" x2="100" y2="14" stroke="#c3cfee" strokeWidth="3" strokeLinecap="round" />
          <circle cx="100" cy="12" r="6" fill="#ffe9b8" className="astra-core" />
          <ellipse cx="100" cy="12" rx="13" ry="5" fill="none" stroke="#ffc457" strokeWidth="1.6" transform="rotate(-18 100 12)" />
          <circle cx="100" cy="12" r="16" fill="url(#as-glow)" opacity="0.55" />
        </g>

        {/* olhos */}
        {mood === "happy" ? (
          <g fill="none" stroke="#1d2566" strokeWidth="4" strokeLinecap="round">
            <path d="M64 108 Q 76 92 88 108" />
            <path d="M112 108 Q 124 92 136 108" />
          </g>
        ) : (
          <g className="astra-eyes">
            <ellipse cx="76" cy="104" rx={13 * big} ry={16 * big} fill="#ffffff" />
            <ellipse cx="124" cy="104" rx={13 * big} ry={16 * big} fill="#ffffff" />
            <g clipPath="url(#as-eye-l)">
              <ellipse cx={76 + look.x} cy={106 + look.y} rx="11" ry="14" fill="url(#as-iris)" />
              <ellipse cx={76 + look.x} cy={108 + look.y} rx="5.2" ry="7.4" fill="#1b1e5e" />
            </g>
            <g clipPath="url(#as-eye-r)">
              <ellipse cx={124 + look.x} cy={106 + look.y} rx="11" ry="14" fill="url(#as-iris)" />
              <ellipse cx={124 + look.x} cy={108 + look.y} rx="5.2" ry="7.4" fill="#1b1e5e" />
            </g>
            <circle cx={71 + look.x * 0.5} cy={99 + look.y * 0.5} r="3.6" fill="#fff" />
            <circle cx={119 + look.x * 0.5} cy={99 + look.y * 0.5} r="3.6" fill="#fff" />
            <circle cx={80 + look.x * 0.5} cy={112 + look.y * 0.5} r="1.8" fill="#fff" opacity="0.9" />
            <circle cx={128 + look.x * 0.5} cy={112 + look.y * 0.5} r="1.8" fill="#fff" opacity="0.9" />
            {/* cílios */}
            <path d="M61 92 Q 68 86 78 88" fill="none" stroke="#1d2566" strokeWidth="3.4" strokeLinecap="round" />
            <path d="M139 92 Q 132 86 122 88" fill="none" stroke="#1d2566" strokeWidth="3.4" strokeLinecap="round" />
          </g>
        )}

        {/* sobrancelhas */}
        {mood === "alert" && (
          <g stroke="#4c3fd1" strokeWidth="3" strokeLinecap="round" fill="none">
            <path d="M62 80 L 88 76" />
            <path d="M138 80 L 112 76" />
          </g>
        )}
        {mood === "think" && <path d="M114 78 Q 126 72 138 78" stroke="#4c3fd1" strokeWidth="3" strokeLinecap="round" fill="none" />}

        {/* bochechas e boca */}
        <ellipse cx="64" cy="124" rx="9" ry="5" fill="#ff8fb8" opacity="0.5" />
        <ellipse cx="136" cy="124" rx="9" ry="5" fill="#ff8fb8" opacity="0.5" />
        {mood === "happy" && <path d="M88 130 Q 100 146 112 130 Z" fill="#7a2a55" />}
        {mood === "neutral" && <path d="M92 132 Q 100 138 108 132" fill="none" stroke="#7a2a55" strokeWidth="3" strokeLinecap="round" />}
        {mood === "search" && <ellipse cx="100" cy="134" rx="4.2" ry="5" fill="#7a2a55" />}
        {mood === "alert" && <path d="M90 136 Q 95 130 100 136 Q 105 142 110 136" fill="none" stroke="#7a2a55" strokeWidth="3" strokeLinecap="round" />}
        {mood === "think" && <path d="M92 135 L 108 133" stroke="#7a2a55" strokeWidth="3" strokeLinecap="round" />}
      </g>
    </svg>
  );
}
