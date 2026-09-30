import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

/** Modal sheet: bottom sheet on phones, centered dialog on wide screens. Esc closes. */
export function Sheet(props: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { onClose } = props;
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      'textarea, input, select, button:not(.sheet-close)',
    );
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className={`sheet${props.wide ? ' sheet-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
      >
        <header className="sheet-head">
          <h2 id={titleId}>{props.title}</h2>
          {onClose && (
            <button
              type="button"
              className="sheet-close icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          )}
        </header>
        <div className="sheet-body">{props.children}</div>
        {props.footer && <footer className="sheet-foot">{props.footer}</footer>}
      </div>
    </div>
  );
}

export function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div className="errors" role="alert">
      {errors.map((e) => (
        <p key={e}>{e}</p>
      ))}
    </div>
  );
}
