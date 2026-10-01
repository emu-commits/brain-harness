import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store';
import { doneLog } from '../../../core/engines/progress';
import type { Evidence } from '../../../core/model/types';
import { fmtDate, fmtMinutes } from '../../format';

/** Everything you've finished, with the evidence you left. Progress you can look back on. */
export function Done() {
  const { ws, goal } = useStore();
  if (!goal) return null;
  const log = doneLog(ws, goal.id);
  const minutes = log.reduce((a, d) => a + d.minutes, 0);
  const withEvidence = log.filter((d) => d.evidence.length).length;
  return (
    <div className="page done">
      <p className="muted small">
        <Link to="/today">← Today</Link>
      </p>
      <h1 className="page-title">What you’ve done</h1>
      {log.length === 0 ? (
        <p className="muted">Nothing finished yet. The first one is the hardest.</p>
      ) : (
        <>
          <p className="muted">
            {log.length} task{log.length === 1 ? '' : 's'} finished
            {minutes ? ` · ${fmtMinutes(minutes)} of your time` : ''}
            {withEvidence ? ` · ${withEvidence} with evidence` : ''}
          </p>
          <ol className="done-log">
            {log.map((d) => (
              <li key={d.taskId} className="card">
                <p className="eyebrow">
                  {fmtDate(d.completedAt.slice(0, 10))}
                  {d.milestoneTitle ? ` · ${d.milestoneTitle}` : ''}
                </p>
                <h2>{d.title}</h2>
                {d.minutes > 0 && <p className="muted small">{fmtMinutes(d.minutes)}</p>}
                {d.evidence.map((e) => (
                  <EvidenceView key={e.id} e={e} />
                ))}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function EvidenceView({ e }: { e: Evidence }) {
  if (e.kind === 'note') return <blockquote className="evidence">{e.text}</blockquote>;
  if (e.kind === 'url')
    return (
      <p className="evidence">
        <a href={e.url} target="_blank" rel="noreferrer noopener">
          {e.url}
        </a>
      </p>
    );
  if (e.kind === 'metric' || e.kind === 'amount')
    return (
      <p className="evidence">
        {e.metricName}: <strong>{e.value}</strong>
      </p>
    );
  if (e.kind === 'image' && e.imageBlobId)
    return <EvidenceImage id={e.imageBlobId} alt={e.text ?? 'Evidence photo'} />;
  return null;
}

function EvidenceImage({ id, alt }: { id: string; alt: string }) {
  const { storage } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    storage.getImage(id).then((img) => {
      if (img) {
        u = URL.createObjectURL(img.blob);
        setUrl(u);
      }
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, storage]);
  return url ? <img className="evidence-img" src={url} alt={alt} /> : null;
}
