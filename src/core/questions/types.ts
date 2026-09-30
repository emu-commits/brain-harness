import type { AccountType, Cents, ID, ISODate, Range, WeekMinutes } from '../model/types';

// Question schema (SPEC §7.1). Composite answer types beyond the spec's list are noted in DECISIONS.md.

export type AnswerType =
  | 'text'
  | 'longText'
  | 'number'
  | 'money'
  | 'range'
  | 'moneyRange'
  | 'minutesRange'
  | 'date'
  | 'choice'
  | 'multiChoice'
  | 'taskList'
  | 'ifThen'
  // Composites:
  | 'criterion'
  | 'capacity'
  | 'firstTask'
  | 'account'
  | 'revenueStart'
  | 'premortem';

export type WriteTarget =
  | { kind: 'goal.title' }
  | { kind: 'goal.successCriterion' }
  | { kind: 'goal.targetDate' }
  | { kind: 'goal.charter.why' }
  | { kind: 'goal.charter.obstacle' }
  | { kind: 'goal.charter.obstaclePlan' }
  | { kind: 'goal.premortem' }
  | { kind: 'capacity' }
  | { kind: 'createAccount' }
  | { kind: 'createMilestone'; beforeMilestoneId?: ID }
  | { kind: 'createTask'; milestoneId?: ID; testsAssumptionId?: ID; withIntention?: boolean }
  | { kind: 'createTasks'; milestoneId: ID }
  | { kind: 'task.definitionOfDone'; taskId: ID }
  | { kind: 'task.estimateMinutes'; taskId: ID }
  | { kind: 'task.referenceMinutes'; taskId: ID }
  | { kind: 'task.split'; taskId: ID }
  | { kind: 'task.dependencies'; taskId: ID }
  | { kind: 'revenue.start'; streamId: ID };

export type Answer =
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'money'; value: Cents }
  | { type: 'date'; value: ISODate }
  | { type: 'range'; value: Range }
  | { type: 'choice'; value: string }
  | { type: 'multiChoice'; values: string[] }
  | { type: 'taskList'; titles: string[] }
  | { type: 'ifThen'; when: string; then: string }
  | { type: 'criterion'; description: string; metric: string; target?: number; unit: string }
  | { type: 'capacity'; minutesByWeekday: WeekMinutes }
  | { type: 'firstTask'; title: string; when: string; where: string; definitionOfDone: string }
  | { type: 'account'; name: string; accountType: AccountType; balance: Cents }
  | { type: 'revenueStart'; milestoneId?: ID; startMonth?: string }
  | { type: 'premortem'; reasons: string[] };

export interface Question {
  /** Stable id, e.g. 'C2', 'G3', 'P1'. */
  id: string;
  stage: 'charter' | 'gap' | 'premortem' | 'estimate' | 'review' | 'hook';
  /** May contain {placeholders} filled from context. */
  prompt: string;
  /** Shorter prompt for scaffold level 2+. */
  shortPrompt?: string;
  /** One short line under the prompt (level 1 only). */
  helper?: string;
  placeholder?: string;
  answerType: AnswerType;
  writes: WriteTarget;
  appliesTo?: 'goal' | 'milestone' | 'task' | 'assumption' | 'revenueStream';
  /** Id of a curated example, shown only after an attempt or "I'm stuck". */
  example?: string;
  minScaffoldLevel?: 1 | 2 | 3;
  followUps?: string[];
}
