/**
 * The DSNL mark as an SVG — five heads round a pentagon, each with a rounded
 * triangle pointing in to the centre — so it can sit straight on the sidebar
 * with no white tile behind it, in whatever colour the theme calls for. Drawn
 * in `currentColor`: set the colour with a text class.
 *
 * The same artwork, in its two brand colours, is in public/dsnl-mark-blue.svg
 * and public/dsnl-mark-dark-blue.svg.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 430 420" className={className} aria-hidden="true" focusable="false">
      <g fill="currentColor" stroke="currentColor" strokeLinejoin="round" strokeWidth={36}>
        {[0, 72, 144, 216, 288].map((angle) => (
          <g key={angle} transform={`rotate(${angle} 215 221)`}>
            <circle cx={215} cy={52} r={37} stroke="none" />
            <polygon points="172,121 258,121 215,174" />
          </g>
        ))}
      </g>
    </svg>
  );
}
