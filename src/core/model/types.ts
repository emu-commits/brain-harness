// Domain model (SPEC §8). Money is integer cents. Dates are local calendar 'YYYY-MM-DD'.

export type ID = string;
export type ISODate = string;
export type ISOTime = string;
export type Cents = number;

export interface Range {
  low: number;
  base: number;
  high: number;
}

export type Pick = 'low' | 'base' | 'high';

export interface Goal {
  id: ID;
  title: string;
  status: 'active' | 'paused' | 'achieved' | 'abandoned';
  targetDate: ISODate;
  currency: string;
  createdAt: ISOTime;
  charter: Charter;
  successCriteria: SuccessCriterion[];
  scaffoldLevel: 1 | 2 | 3;
  /** When the scaffold level last changed; promotion counts sessions after this. */
  scaffoldChangedAt?: ISOTime;
  /** Set when the premortem was last completed. */
  premortemDoneAt?: ISOTime;
  /** Fictional sample data loaded from Settings. Never mixed with real goals. */
  isDemo?: boolean;
}

export interface Charter {
  why: string;
  obstacle: string;
  /** If-then text: "When ___, I will ___". */
  obstaclePlan: string;
  premortem: PremortemEntry[];
  commitments: Commitment[];
}

export interface PremortemEntry {
  id: ID;
  reason: string;
  response: 'task' | 'assumption' | 'risk';
  linkedId?: ID;
}

export type CommitmentRule =
  | { kind: 'maxWeeklyMinutes'; value: number }
  | { kind: 'maxSpendBeforeMilestone'; cents: Cents; milestoneId: ID };

export interface Commitment {
  id: ID;
  text: string;
  rule?: CommitmentRule;
}

export type TrackedBy =
  | { kind: 'tasks' }
  | { kind: 'netWorth' }
  | { kind: 'monthlyRevenue' }
  | { kind: 'accountBalance'; accountId: ID }
  | { kind: 'manual' };

export interface SuccessCriterion {
  id: ID;
  description: string;
  metric: string;
  unit: string;
  /** For money-tracked criteria (netWorth, monthlyRevenue, accountBalance) this is in cents. */
  target: number;
  minimum?: number;
  stretch?: number;
  deadline: ISODate;
  trackedBy: TrackedBy;
  /** Latest value the user recorded, for manual tracking. */
  recorded?: { value: number; at: ISOTime };
}

export interface Milestone {
  id: ID;
  goalId: ID;
  title: string;
  /** Lower comes first. Backward chaining inserts below the current minimum. */
  order: number;
  definitionOfDone: string;
}

export type TaskStatus = 'ready' | 'inProgress' | 'blocked' | 'completed' | 'skipped';

export interface Intention {
  when: string;
  where: string;
  ifThen?: string;
}

export interface Task {
  id: ID;
  goalId: ID;
  /** No milestoneId = inbox (unplanned). */
  milestoneId?: ID;
  title: string;
  kind: 'work' | 'wait' | 'decision';
  definitionOfDone: string;
  estimateMinutes?: Range;
  waitDays?: Range;
  referenceMinutes?: number;
  /** Cents, incurred at finish. */
  cost?: Range;
  status: TaskStatus;
  priority: 1 | 2 | 3;
  energy: 'deep' | 'shallow';
  category?: string;
  earliestStart?: ISODate;
  /** Optional user target date; used as a scheduling tie-break. */
  targetDate?: ISODate;
  intention?: Intention;
  testsAssumptionId?: ID;
  skippedReason?: string;
  /** When status last became 'blocked'. */
  blockedAt?: ISOTime;
  /** Named external blocker, if any. */
  blockerNote?: string;
  /** Who it was delegated to, if anyone. */
  delegatedTo?: string;
  /** Added in an Execute session (inbox capture), not during planning. */
  addedOutsidePlan?: boolean;
  createdAt: ISOTime;
  completedAt?: ISOTime;
}

/** Finish-to-start. fromTask must finish before toTask starts (plus lagDays). */
export interface Dependency {
  id: ID;
  fromTaskId: ID;
  toTaskId: ID;
  lagDays: number;
}

export type AssumptionStatus = 'untested' | 'supported' | 'contradicted' | 'revised';

export interface Assumption {
  id: ID;
  goalId: ID;
  statement: string;
  unit?: string;
  value?: Range;
  confidence: 'low' | 'medium' | 'high';
  status: AssumptionStatus;
  history: { at: ISOTime; value?: Range; status: AssumptionStatus }[];
}

export type WeekMinutes = [number, number, number, number, number, number, number];

export interface Capacity {
  goalId: ID;
  /** Sun..Sat. */
  minutesByWeekday: WeekMinutes;
  peakWindows?: { weekday: number; start: string; end: string }[];
}

export type SessionMode = 'plan' | 'execute' | 'review';

export interface GapStats {
  shown: number;
  resolved: number;
  stuckTaps: number;
}

export interface Session {
  id: ID;
  goalId: ID;
  mode: SessionMode;
  startedAt: ISOTime;
  endedAt?: ISOTime;
  handoffNote?: string;
  /** The user skipped the handoff note (tracked, per SPEC §5.2). */
  handoffSkipped?: boolean;
  /** Plan sessions: gap questions shown / resolved / "I'm stuck" taps, for scaffold promotion. */
  gapStats?: GapStats;
}

export interface ExecutionRecord {
  id: ID;
  taskId: ID;
  sessionId: ID;
  startedAt: ISOTime;
  endedAt: ISOTime;
  minutes: number;
  cost?: Cents;
  predictedMinutes?: number;
  surprise?: string;
}

export interface Evidence {
  id: ID;
  taskId: ID;
  kind: 'note' | 'url' | 'metric' | 'amount' | 'image';
  text?: string;
  url?: string;
  metricName?: string;
  value?: number;
  imageBlobId?: ID;
  createdAt: ISOTime;
}

export interface MemoryEntry {
  id: ID;
  goalId: ID;
  kind: 'decision' | 'lesson';
  text: string;
  createdAt: ISOTime;
  sessionId: ID;
}

export interface Prediction {
  id: ID;
  goalId: ID;
  subject: 'goalDate' | 'milestoneDate' | 'taskMinutes';
  subjectId: ID;
  predicted: string | number;
  computed?: string | number;
  realized?: string | number;
  createdAt: ISOTime;
}

export interface CalibrationDecision {
  id: ID;
  goalId: ID;
  category: string;
  multiplier: number;
  acceptedAt: ISOTime;
}

export type AccountType =
  'cash' | 'savings' | 'investment' | 'retirement' | 'business' | 'debt' | 'other';

export interface FinancialAccount {
  id: ID;
  /** Not in SPEC §8; added so "one runway source per goal" is checkable. See DECISIONS.md. */
  goalId: ID;
  name: string;
  type: AccountType;
  /** Debts: positive number = amount owed. */
  balance: Cents;
  annualRate: Range;
  monthlyContribution: Cents;
  isRunwaySource: boolean;
}

export interface CashFlow {
  id: ID;
  goalId: ID;
  name: string;
  /** Signed: + inflow, − outflow. */
  amount: Cents;
  accountId: ID;
  startMonth: string;
  endMonth?: string;
  recurrence: 'once' | 'monthly';
  inflationAdjusted: boolean;
}

export interface RevenueStream {
  id: ID;
  goalId: ID;
  name: string;
  accountId: ID;
  startsAfterMilestoneId?: ID;
  startMonth?: string;
  rampMonths: Range;
  /** Cents. */
  targetMonthly: Range;
}

export type ScenarioId = 'conservative' | 'base' | 'optimistic';
export const SCENARIOS: readonly ScenarioId[] = ['conservative', 'base', 'optimistic'];

export interface ScenarioMultipliers {
  duration: number;
  capacity: number;
  cost: number;
  revenue: number;
}

export interface ScenarioSettings {
  goalId: ID;
  inflationAnnual: number;
  horizonMonths: number;
  multipliers: Record<ScenarioId, ScenarioMultipliers>;
}

export interface ForecastSnapshot {
  id: ID;
  goalId: ID;
  createdAt: ISOTime;
  engineVersion: string;
  reason: 'initial' | 'manual' | 'reforecast' | 'planChange';
  inputsHash: string;
  // Stored loosely here to keep the model layer independent of the engines.
  inputs: unknown;
  outputs: unknown;
}

/** User preferences and thresholds. Single row with id 'settings'. */
export interface Settings {
  id: 'settings';
  activeGoalId?: ID;
  resumeThresholdDays: number;
  maxGapsPerSession: number;
  splitThresholdMinutes: number;
  blockedAssumeDays: number;
  stuck: { sessions: number; overrunFactor: number; blockedDays: number };
  calibration: { window: number; minTasks: number };
  lastExportAt?: ISOTime;
  /** A running task timer, persisted so it survives reloads. */
  running?: { taskId: ID; sessionId: ID; startedAt: ISOTime; predictedMinutes?: number };
  /** Resume prompt already acknowledged for this session id. */
  resumeAckFor?: ID;
  storagePersisted?: boolean;
}

/** A dismissed gap, suppressed until the object it points at changes. */
export interface GapDismissal {
  id: ID;
  gapKey: string;
  objectHash: string;
  at: ISOTime;
}

/** Local count of "I'm stuck" taps per question id. */
export interface QuestionStat {
  id: string;
  stuckTaps: number;
  attempts: number;
}

export interface ImageBlob {
  id: ID;
  type: string;
  blob: Blob;
}

/** The whole persisted model, normalized one array per table. */
export interface Workspace {
  goals: Goal[];
  milestones: Milestone[];
  tasks: Task[];
  dependencies: Dependency[];
  assumptions: Assumption[];
  capacities: Capacity[];
  sessions: Session[];
  executionRecords: ExecutionRecord[];
  evidence: Evidence[];
  memory: MemoryEntry[];
  predictions: Prediction[];
  calibrationDecisions: CalibrationDecision[];
  accounts: FinancialAccount[];
  cashFlows: CashFlow[];
  revenueStreams: RevenueStream[];
  scenarioSettings: ScenarioSettings[];
  snapshots: ForecastSnapshot[];
  settings: Settings[];
  gapDismissals: GapDismissal[];
  questionStats: QuestionStat[];
}

export type TableName = keyof Workspace;

export const TABLES: readonly TableName[] = [
  'goals',
  'milestones',
  'tasks',
  'dependencies',
  'assumptions',
  'capacities',
  'sessions',
  'executionRecords',
  'evidence',
  'memory',
  'predictions',
  'calibrationDecisions',
  'accounts',
  'cashFlows',
  'revenueStreams',
  'scenarioSettings',
  'snapshots',
  'settings',
  'gapDismissals',
  'questionStats',
];

/** Primary key field per table. */
export const TABLE_KEYS: Record<TableName, string> = {
  goals: 'id',
  milestones: 'id',
  tasks: 'id',
  dependencies: 'id',
  assumptions: 'id',
  capacities: 'goalId',
  sessions: 'id',
  executionRecords: 'id',
  evidence: 'id',
  memory: 'id',
  predictions: 'id',
  calibrationDecisions: 'id',
  accounts: 'id',
  cashFlows: 'id',
  revenueStreams: 'id',
  scenarioSettings: 'goalId',
  snapshots: 'id',
  settings: 'id',
  gapDismissals: 'id',
  questionStats: 'id',
};

export const SCHEMA_VERSION = 1;
