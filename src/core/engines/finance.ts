import type {
  CashFlow,
  Cents,
  FinancialAccount,
  ID,
  ISODate,
  Pick,
  Range,
  RevenueStream,
} from '../model/types';
import { cmp } from '../model/factories';
import { addMonths, formatMonthIndex, monthIndex, yearMonth } from '../util/dates';
import { roundCents } from '../util/money';

// Monthly financial projection (SPEC §9.4). Hypothetical model of user-entered assumptions.

export interface FinancePicks {
  cost: Pick;
  revenue: Pick;
  ramp: Pick;
  assetRate: Pick;
  debtRate: Pick;
}

export interface FinanceInput {
  /** 'YYYY-MM' of today; month m = 0. */
  startMonth: string;
  horizonMonths: number;
  picks: FinancePicks;
  costMult: number;
  revenueMult: number;
  inflationAnnual: number;
  accounts: readonly FinancialAccount[];
  cashFlows: readonly CashFlow[];
  revenueStreams: readonly RevenueStream[];
  /** Unfinished tasks with a cost, and the date the schedule finishes them. */
  taskCosts: readonly { taskId: ID; finish: ISODate; cost: Range }[];
  /** Scheduled milestone completion dates, for revenue streams that start after a milestone. */
  milestoneDates: Readonly<Record<ID, ISODate | null>>;
}

export interface MonthRow {
  month: string;
  balances: Record<ID, Cents>;
  netWorth: Cents;
  /** Runway account balance (null if there are no accounts). */
  runway: Cents | null;
  revenue: Cents;
  goalCosts: Cents;
}

export interface FinanceOutput {
  months: MonthRow[];
  runwayExhaustedMonth: string | null;
  /** All remaining goal task costs under this scenario, whether or not inside the horizon. */
  totalGoalCost: Cents;
  /** Revenue stream id → first active month, or null if it never starts. */
  revenueStarts: Record<ID, string | null>;
}

export function monthlyRate(annual: number): number {
  return Math.pow(1 + annual, 1 / 12) - 1;
}

const isDebt = (a: FinancialAccount) => a.type === 'debt';

export function revenueStartMonth(
  s: RevenueStream,
  milestoneDates: Readonly<Record<ID, ISODate | null>>,
): string | null {
  if (s.startMonth) return s.startMonth;
  if (!s.startsAfterMilestoneId) return null;
  const d = milestoneDates[s.startsAfterMilestoneId];
  return d ? addMonths(yearMonth(d), 1) : null;
}

export function projectFinances(input: FinanceInput): FinanceOutput {
  const { picks } = input;
  const accounts = [...input.accounts].sort((a, b) => cmp(a.id, b.id));
  const balances = new Map<ID, Cents>(accounts.map((a) => [a.id, a.balance]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const runway = accounts.find((a) => a.isRunwaySource) ?? null;
  const start = monthIndex(input.startMonth);

  /** Apply a cash inflow (negative = outflow). Debts: inflow pays down the amount owed. */
  const applyCash = (accountId: ID, delta: Cents) => {
    const a = byId.get(accountId);
    if (!a) return;
    const b = balances.get(accountId)!;
    balances.set(accountId, isDebt(a) ? b - delta : b + delta);
  };

  const costsByMonth = new Map<number, Cents>();
  let totalGoalCost = 0;
  for (const tc of input.taskCosts) {
    const c = roundCents(tc.cost[picks.cost] * input.costMult);
    totalGoalCost += c;
    const mi = monthIndex(yearMonth(tc.finish));
    costsByMonth.set(mi, (costsByMonth.get(mi) ?? 0) + c);
  }

  const streams = [...input.revenueStreams].sort((a, b) => cmp(a.id, b.id));
  const revenueStarts: Record<ID, string | null> = {};
  const streamStart = new Map<ID, number | null>();
  for (const s of streams) {
    const sm = revenueStartMonth(s, input.milestoneDates);
    revenueStarts[s.id] = sm;
    streamStart.set(s.id, sm ? monthIndex(sm) : null);
  }

  const flows = [...input.cashFlows].sort((a, b) => cmp(a.id, b.id));
  const months: MonthRow[] = [];
  let runwayExhaustedMonth: string | null = null;

  for (let m = 0; m <= input.horizonMonths; m++) {
    const mi = start + m;

    // 1. Growth on the starting balance, then contributions / payments. Accounts in id order.
    for (const a of accounts) {
      const startBal = balances.get(a.id)!;
      const rate = a.annualRate[isDebt(a) ? picks.debtRate : picks.assetRate];
      const growth = roundCents(startBal * monthlyRate(rate));
      let bal = startBal + growth;
      if (isDebt(a)) bal -= Math.min(a.monthlyContribution, Math.max(bal, 0));
      else bal += a.monthlyContribution;
      balances.set(a.id, bal);
    }

    // 2. Cash flows active this month.
    for (const f of flows) {
      const fs = monthIndex(f.startMonth);
      const active =
        f.recurrence === 'once'
          ? mi === fs
          : mi >= fs && (f.endMonth === undefined || mi <= monthIndex(f.endMonth));
      if (!active) continue;
      const amt = f.inflationAdjusted
        ? roundCents(f.amount * Math.pow(1 + input.inflationAnnual, m / 12))
        : f.amount;
      applyCash(f.accountId, amt);
    }

    // 3. Goal costs for tasks finishing this month.
    const goalCosts = costsByMonth.get(mi) ?? 0;
    if (runway && goalCosts) applyCash(runway.id, -goalCosts);

    // 4. Revenue with linear ramp.
    let revenue = 0;
    for (const s of streams) {
      const si = streamStart.get(s.id);
      if (si === null || si === undefined || mi < si) continue;
      const k = mi - si + 1;
      const ramp = Math.max(1, s.rampMonths[picks.ramp]);
      const monthly = roundCents(
        s.targetMonthly[picks.revenue] * input.revenueMult * Math.min(1, k / ramp),
      );
      revenue += monthly;
      applyCash(s.accountId, monthly);
    }

    const snapshot: Record<ID, Cents> = {};
    let netWorth = 0;
    for (const a of accounts) {
      const b = balances.get(a.id)!;
      snapshot[a.id] = b;
      netWorth += isDebt(a) ? -b : b;
    }
    const runwayBal = runway ? balances.get(runway.id)! : null;
    if (runwayExhaustedMonth === null && runwayBal !== null && runwayBal < 0) {
      runwayExhaustedMonth = formatMonthIndex(mi);
    }
    months.push({
      month: formatMonthIndex(mi),
      balances: snapshot,
      netWorth,
      runway: runwayBal,
      revenue,
      goalCosts,
    });
  }

  return { months, runwayExhaustedMonth, totalGoalCost, revenueStarts };
}
