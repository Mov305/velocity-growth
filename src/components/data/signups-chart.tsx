import type { SignupDay } from '@/lib/queries/dashboard';

const W = 720;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 26, left: 36 };

const dayLabel = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});

/**
 * One series, so one hue and no legend: the title names it. Thin bars from a true zero
 * baseline, a 2px gap between bars, a per-bar tooltip, and an explicit empty state when the
 * whole window is zero so a quiet month never looks like a broken chart.
 */
export function SignupsChart({ days }: { days: SignupDay[] }) {
  const max = Math.max(0, ...days.map((d) => d.signups));
  const total = days.reduce((n, d) => n + d.signups, 0);
  const first = days[0]?.day;
  const last = days[days.length - 1]?.day;

  if (total === 0) {
    return (
      <div className="rounded-sm border border-dashed border-rule px-6 py-10 text-center">
        <p className="font-heading text-lg">
          No signups between {dayLabel.format(new Date(first))} and{' '}
          {dayLabel.format(new Date(last))}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Thirty days, all zero. The seed data for this brand ends earlier than this window.
        </p>
      </div>
    );
  }

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / days.length;
  const barW = Math.max(2, slot - 2);
  const y = (v: number) => PAD.top + innerH - (max === 0 ? 0 : (v / max) * innerH);
  const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <figure className="rounded-sm border border-rule bg-card p-4">
      <figcaption className="mb-2 flex items-baseline justify-between">
        <span className="text-sm">Signups per day, last 30 days</span>
        <span className="font-mono text-xs text-muted-foreground">
          {total.toLocaleString('en-GB')} in window · peak {max.toLocaleString('en-GB')}
        </span>
      </figcaption>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Signups per day from ${first} to ${last}`}
          className="h-auto w-full min-w-[520px]"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--rule)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(t) + 3}
                textAnchor="end"
                fontSize={10}
                fontFamily="var(--font-plex-mono)"
                fill="var(--muted-foreground)"
              >
                {t.toLocaleString('en-GB')}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = PAD.left + i * slot + 1;
            const top = y(d.signups);
            const h = PAD.top + innerH - top;
            return (
              <g key={d.day} className="chart-bar">
                <title>{`${dayLabel.format(new Date(d.day))}: ${d.signups.toLocaleString('en-GB')} signups`}</title>
                <rect x={x} y={PAD.top} width={barW} height={innerH} fill="transparent" />
                {h > 0 ? (
                  <rect x={x} y={top} width={barW} height={h} rx={2} fill="var(--accent-ink)" />
                ) : null}
                {i % 7 === 0 || i === days.length - 1 ? (
                  <text
                    x={x + barW / 2}
                    y={H - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fontFamily="var(--font-plex-mono)"
                    fill="var(--muted-foreground)"
                  >
                    {dayLabel.format(new Date(d.day))}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + innerH}
            y2={PAD.top + innerH}
            stroke="var(--ink)"
            strokeWidth={1}
          />
        </svg>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-xs text-muted-foreground">
          table view
        </summary>
        <table className="mt-2 w-full font-mono text-xs">
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-t border-rule">
                <td className="py-0.5">{d.day}</td>
                <td className="py-0.5 text-right">{d.signups.toLocaleString('en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
