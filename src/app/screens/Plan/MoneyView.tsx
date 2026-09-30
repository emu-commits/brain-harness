import { useState } from 'react';
import { useStore } from '../../store';
import type {
  AccountType,
  CashFlow,
  FinancialAccount,
  RevenueStream,
  Workspace,
} from '../../../core/model/types';
import { milestonesOfGoal, upsert } from '../../../core/model/factories';
import { yearMonth } from '../../../core/util/dates';
import { Errors, Sheet } from '../../components/Sheet';
import { Field, MoneyInput, MoneyRangeInput, NumberRangeInput } from '../../components/inputs';
import { fmtMoney, fmtMonth } from '../../format';

export const DISCLAIMER =
  'Financial figures are hypothetical models of the assumptions you entered, not predictions and not financial advice.';

export function MoneyView({ editable }: { editable: boolean }) {
  const { ws, goal } = useStore();
  const [edit, setEdit] = useState<
    | null
    | { kind: 'account'; row?: FinancialAccount }
    | { kind: 'flow'; row?: CashFlow }
    | { kind: 'stream'; row?: RevenueStream }
  >(null);
  if (!goal) return null;
  const accounts = ws.accounts.filter((a) => a.goalId === goal.id);
  const flows = ws.cashFlows.filter((a) => a.goalId === goal.id);
  const streams = ws.revenueStreams.filter((a) => a.goalId === goal.id);
  const ms = milestonesOfGoal(ws, goal.id);
  const pct = (r: { low: number; base: number; high: number }) =>
    `${+(r.low * 100).toFixed(2)}–${+(r.high * 100).toFixed(2)}%`;
  return (
    <div className="money-view">
      <p className="disclaimer">{DISCLAIMER}</p>
      <section className="card">
        <header className="ms-head">
          <h3>Accounts</h3>
          {editable && (
            <button
              type="button"
              className="btn small"
              onClick={() => setEdit({ kind: 'account' })}
            >
              + Account
            </button>
          )}
        </header>
        {!accounts.length && (
          <p className="muted small">
            What money are you starting with? One account is enough; it becomes the runway account
            that goal costs and revenue settle into.
          </p>
        )}
        <ul className="rows">
          {accounts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="row-btn"
                onClick={() => setEdit({ kind: 'account', row: a })}
              >
                <span>
                  {a.name} {a.isRunwaySource && <span className="badge">runway</span>}
                </span>
                <span className="muted small">
                  {a.type} · {a.type === 'debt' ? 'owed ' : ''}
                  {fmtMoney(a.balance, goal.currency)} · {pct(a.annualRate)} / yr
                  {a.monthlyContribution
                    ? ` · ${a.type === 'debt' ? 'pays' : 'adds'} ${fmtMoney(a.monthlyContribution, goal.currency)}/mo`
                    : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <header className="ms-head">
          <h3>Cash flows</h3>
          {editable && accounts.length > 0 && (
            <button type="button" className="btn small" onClick={() => setEdit({ kind: 'flow' })}>
              + Cash flow
            </button>
          )}
        </header>
        {!flows.length && (
          <p className="muted small">
            Regular or one-off money in or out, like rent, a salary, or a grant.
          </p>
        )}
        <ul className="rows">
          {flows.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="row-btn"
                onClick={() => setEdit({ kind: 'flow', row: f })}
              >
                <span>{f.name}</span>
                <span className="muted small">
                  {f.amount >= 0 ? '+' : ''}
                  {fmtMoney(f.amount, goal.currency)} {f.recurrence === 'monthly' ? '/ mo' : 'once'}{' '}
                  · from {fmtMonth(f.startMonth)}
                  {f.endMonth ? ` to ${fmtMonth(f.endMonth)}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <header className="ms-head">
          <h3>Revenue streams</h3>
          {editable && accounts.length > 0 && (
            <button type="button" className="btn small" onClick={() => setEdit({ kind: 'stream' })}>
              + Revenue stream
            </button>
          )}
        </header>
        {!streams.length && (
          <p className="muted small">
            Income this goal is meant to produce, starting after a milestone or on a date, ramping
            up over months.
          </p>
        )}
        <ul className="rows">
          {streams.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="row-btn"
                onClick={() => setEdit({ kind: 'stream', row: s })}
              >
                <span>{s.name}</span>
                <span className="muted small">
                  {fmtMoney(s.targetMonthly.low, goal.currency)}–
                  {fmtMoney(s.targetMonthly.high, goal.currency)} / mo ·{' '}
                  {s.startMonth
                    ? `from ${fmtMonth(s.startMonth)}`
                    : s.startsAfterMilestoneId
                      ? `after “${ms.find((m) => m.id === s.startsAfterMilestoneId)?.title}”`
                      : 'no start yet'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {edit?.kind === 'account' && (
        <AccountSheet row={edit.row} editable={editable} onClose={() => setEdit(null)} />
      )}
      {edit?.kind === 'flow' && (
        <FlowSheet row={edit.row} editable={editable} onClose={() => setEdit(null)} />
      )}
      {edit?.kind === 'stream' && (
        <StreamSheet row={edit.row} editable={editable} onClose={() => setEdit(null)} />
      )}
    </div>
  );
}

function useSaver(onClose: () => void) {
  const { commit } = useStore();
  const [errors, setErrors] = useState<string[]>([]);
  const run = async (fn: (w: Workspace) => Workspace) => {
    const r = await commit(fn);
    if (!r.ok) return setErrors(r.errors);
    onClose();
  };
  return { errors, setErrors, run };
}

function Footer({
  editable,
  onDelete,
  onSave,
}: {
  editable: boolean;
  onDelete?: () => void;
  onSave: () => void;
}) {
  if (!editable) return null;
  return (
    <>
      {onDelete && (
        <button type="button" className="btn ghost" onClick={onDelete}>
          Delete
        </button>
      )}
      <span className="spacer" />
      <button type="button" className="btn primary" onClick={onSave}>
        Save
      </button>
    </>
  );
}

function AccountSheet({
  row,
  editable,
  onClose,
}: {
  row?: FinancialAccount;
  editable: boolean;
  onClose: () => void;
}) {
  const { ws, goal, ids } = useStore();
  const { errors, setErrors, run } = useSaver(onClose);
  const others = ws.accounts.filter((a) => a.goalId === goal!.id && a.id !== row?.id);
  const [d, setD] = useState<FinancialAccount>(
    row ?? {
      id: ids.next(),
      goalId: goal!.id,
      name: '',
      type: 'cash',
      balance: 0,
      annualRate: { low: 0, base: 0, high: 0 },
      monthlyContribution: 0,
      isRunwaySource: !others.some((a) => a.isRunwaySource),
    },
  );
  const [rateOk, setRateOk] = useState(true);
  const save = () => {
    if (!rateOk) return setErrors(['Enter the rate as three numbers (percent).']);
    run((w) => {
      let accounts = upsert(w.accounts, d);
      if (d.isRunwaySource)
        accounts = accounts.map((a) =>
          a.goalId === d.goalId && a.id !== d.id ? { ...a, isRunwaySource: false } : a,
        );
      return { ...w, accounts };
    });
  };
  const remove = () =>
    run((w) => ({
      ...w,
      accounts: w.accounts.filter((a) => a.id !== d.id),
      cashFlows: w.cashFlows.filter((f) => f.accountId !== d.id),
      revenueStreams: w.revenueStreams.filter((s) => s.accountId !== d.id),
    }));
  return (
    <Sheet
      title={row ? 'Account' : 'New account'}
      onClose={onClose}
      footer={<Footer editable={editable} onSave={save} onDelete={row ? remove : undefined} />}
    >
      <fieldset disabled={!editable} className="plain-fieldset">
        <div className="row2">
          <Field label="Name">
            {(id) => (
              <input
                id={id}
                value={d.name}
                onChange={(e) => setD({ ...d, name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Type">
            {(id) => (
              <select
                id={id}
                value={d.type}
                onChange={(e) =>
                  setD({
                    ...d,
                    type: e.target.value as AccountType,
                    isRunwaySource: e.target.value === 'debt' ? false : d.isRunwaySource,
                  })
                }
              >
                {['cash', 'savings', 'investment', 'retirement', 'business', 'debt', 'other'].map(
                  (t) => (
                    <option key={t}>{t}</option>
                  ),
                )}
              </select>
            )}
          </Field>
        </div>
        <Field
          label={
            d.type === 'debt' ? `Amount owed (${goal!.currency})` : `Balance (${goal!.currency})`
          }
        >
          {(id) => (
            <MoneyInput
              id={id}
              value={d.balance}
              onChange={(c) => c !== null && setD({ ...d, balance: c })}
            />
          )}
        </Field>
        <Field
          label={
            d.type === 'debt'
              ? 'Interest rate per year (%)'
              : 'Growth rate per year (%), hypothetical'
          }
        >
          {() => (
            <NumberRangeInput
              value={d.annualRate}
              scale={100}
              labels={['Low', 'Base', 'High']}
              onChange={(r) => {
                setRateOk(!!r);
                if (r) setD({ ...d, annualRate: r });
              }}
            />
          )}
        </Field>
        <Field
          label={
            d.type === 'debt'
              ? `Monthly payment (${goal!.currency})`
              : `Monthly contribution from outside (${goal!.currency})`
          }
        >
          {(id) => (
            <MoneyInput
              id={id}
              value={d.monthlyContribution}
              onChange={(c) => c !== null && setD({ ...d, monthlyContribution: Math.max(0, c) })}
            />
          )}
        </Field>
        {d.type !== 'debt' && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={d.isRunwaySource}
              onChange={(e) => setD({ ...d, isRunwaySource: e.target.checked })}
            />{' '}
            Runway account (goal costs and revenue settle here)
          </label>
        )}
        <Errors errors={errors} />
      </fieldset>
    </Sheet>
  );
}

function FlowSheet({
  row,
  editable,
  onClose,
}: {
  row?: CashFlow;
  editable: boolean;
  onClose: () => void;
}) {
  const { ws, goal, ids, clock } = useStore();
  const { errors, setErrors, run } = useSaver(onClose);
  const accounts = ws.accounts.filter((a) => a.goalId === goal!.id);
  const [d, setD] = useState<CashFlow>(
    row ?? {
      id: ids.next(),
      goalId: goal!.id,
      name: '',
      amount: 0,
      accountId: (accounts.find((a) => a.isRunwaySource) ?? accounts[0])!.id,
      startMonth: yearMonth(clock.today()),
      recurrence: 'monthly',
      inflationAdjusted: false,
    },
  );
  const [dir, setDir] = useState<'in' | 'out'>(row && row.amount >= 0 ? 'in' : 'out');
  const [amount, setAmount] = useState<number | null>(row ? Math.abs(row.amount) : null);
  const save = () => {
    if (amount === null) return setErrors(['Enter an amount.']);
    const next = { ...d, amount: dir === 'in' ? Math.abs(amount) : -Math.abs(amount) };
    if (!next.endMonth) delete next.endMonth;
    run((w) => ({ ...w, cashFlows: upsert(w.cashFlows, next) }));
  };
  return (
    <Sheet
      title={row ? 'Cash flow' : 'New cash flow'}
      onClose={onClose}
      footer={
        <Footer
          editable={editable}
          onSave={save}
          onDelete={
            row
              ? () => run((w) => ({ ...w, cashFlows: w.cashFlows.filter((f) => f.id !== d.id) }))
              : undefined
          }
        />
      }
    >
      <fieldset disabled={!editable} className="plain-fieldset">
        <Field label="Name">
          {(id) => (
            <input id={id} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          )}
        </Field>
        <div className="row3">
          <Field label="Direction">
            {(id) => (
              <select id={id} value={dir} onChange={(e) => setDir(e.target.value as 'in' | 'out')}>
                <option value="out">Money out</option>
                <option value="in">Money in</option>
              </select>
            )}
          </Field>
          <Field label={`Amount (${goal!.currency})`}>
            {(id) => <MoneyInput id={id} value={amount ?? undefined} onChange={setAmount} />}
          </Field>
          <Field label="How often">
            {(id) => (
              <select
                id={id}
                value={d.recurrence}
                onChange={(e) =>
                  setD({ ...d, recurrence: e.target.value as CashFlow['recurrence'] })
                }
              >
                <option value="monthly">Monthly</option>
                <option value="once">Once</option>
              </select>
            )}
          </Field>
        </div>
        <div className="row3">
          <Field label="Account">
            {(id) => (
              <select
                id={id}
                value={d.accountId}
                onChange={(e) => setD({ ...d, accountId: e.target.value })}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Starts">
            {(id) => (
              <input
                id={id}
                type="month"
                value={d.startMonth}
                onChange={(e) => setD({ ...d, startMonth: e.target.value })}
              />
            )}
          </Field>
          {d.recurrence === 'monthly' && (
            <Field label="Ends (optional)">
              {(id) => (
                <input
                  id={id}
                  type="month"
                  value={d.endMonth ?? ''}
                  onChange={(e) => setD({ ...d, endMonth: e.target.value || undefined })}
                />
              )}
            </Field>
          )}
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={d.inflationAdjusted}
            onChange={(e) => setD({ ...d, inflationAdjusted: e.target.checked })}
          />{' '}
          Grows with inflation
        </label>
        <Errors errors={errors} />
      </fieldset>
    </Sheet>
  );
}

function StreamSheet({
  row,
  editable,
  onClose,
}: {
  row?: RevenueStream;
  editable: boolean;
  onClose: () => void;
}) {
  const { ws, goal, ids } = useStore();
  const { errors, setErrors, run } = useSaver(onClose);
  const accounts = ws.accounts.filter((a) => a.goalId === goal!.id);
  const ms = milestonesOfGoal(ws, goal!.id);
  const [d, setD] = useState<RevenueStream>(
    row ?? {
      id: ids.next(),
      goalId: goal!.id,
      name: '',
      accountId: (accounts.find((a) => a.isRunwaySource) ?? accounts[0])!.id,
      rampMonths: { low: 1, base: 3, high: 6 },
      targetMonthly: { low: 0, base: 0, high: 0 },
    },
  );
  const [startKind, setStartKind] = useState<'milestone' | 'month' | 'none'>(
    row?.startMonth ? 'month' : row?.startsAfterMilestoneId ? 'milestone' : 'none',
  );
  const [okRanges, setOkRanges] = useState({ ramp: true, target: !!row });
  const save = () => {
    if (!okRanges.target) return setErrors(['Enter the monthly target as three amounts.']);
    if (!okRanges.ramp) return setErrors(['Enter ramp months as three numbers.']);
    const next = { ...d };
    if (startKind !== 'milestone') delete next.startsAfterMilestoneId;
    if (startKind !== 'month') delete next.startMonth;
    run((w) => ({ ...w, revenueStreams: upsert(w.revenueStreams, next) }));
  };
  return (
    <Sheet
      title={row ? 'Revenue stream' : 'New revenue stream'}
      onClose={onClose}
      footer={
        <Footer
          editable={editable}
          onSave={save}
          onDelete={
            row
              ? () =>
                  run((w) => ({
                    ...w,
                    revenueStreams: w.revenueStreams.filter((s) => s.id !== d.id),
                  }))
              : undefined
          }
        />
      }
    >
      <fieldset disabled={!editable} className="plain-fieldset">
        <div className="row2">
          <Field label="Name">
            {(id) => (
              <input
                id={id}
                value={d.name}
                onChange={(e) => setD({ ...d, name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Pays into">
            {(id) => (
              <select
                id={id}
                value={d.accountId}
                onChange={(e) => setD({ ...d, accountId: e.target.value })}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label="Monthly revenue once fully ramped (low, likely, high)">
          {() => (
            <MoneyRangeInput
              value={row?.targetMonthly}
              currency={goal!.currency}
              labels={['Low', 'Likely', 'High']}
              onChange={(r) => (
                setOkRanges({ ...okRanges, target: !!r }),
                r && setD({ ...d, targetMonthly: r })
              )}
            />
          )}
        </Field>
        <Field label="Months to ramp up (fast, likely, slow)">
          {() => (
            <NumberRangeInput
              value={d.rampMonths}
              labels={['Fast', 'Likely', 'Slow']}
              onChange={(r) => (
                setOkRanges({ ...okRanges, ramp: !!r }),
                r && setD({ ...d, rampMonths: r })
              )}
            />
          )}
        </Field>
        <Field label="What needs to be done before it starts earning?">
          {(id) => (
            <select
              id={id}
              value={startKind}
              onChange={(e) => setStartKind(e.target.value as typeof startKind)}
            >
              <option value="none">Not decided yet</option>
              <option value="milestone">A milestone</option>
              <option value="month">Nothing; it starts in a given month</option>
            </select>
          )}
        </Field>
        {startKind === 'milestone' && (
          <select
            aria-label="Milestone"
            value={d.startsAfterMilestoneId ?? ''}
            onChange={(e) => setD({ ...d, startsAfterMilestoneId: e.target.value || undefined })}
          >
            <option value="">Choose…</option>
            {ms.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        )}
        {startKind === 'month' && (
          <input
            aria-label="Start month"
            type="month"
            value={d.startMonth ?? ''}
            onChange={(e) => setD({ ...d, startMonth: e.target.value || undefined })}
          />
        )}
        <Errors errors={errors} />
      </fieldset>
    </Sheet>
  );
}
