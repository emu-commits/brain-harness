import type { Question } from './types';

// Question text lives here as data so it can be revised without touching logic (SPEC §7.3).
// Ids inside `writes` are bound at runtime by the gap detector or flow (see bindQuestion).

export const QUESTIONS: Record<string, Question> = {
  // ---- Charter (first run) ----
  C1: {
    id: 'C1',
    stage: 'charter',
    prompt: 'What are you trying to make happen?',
    placeholder: 'I want to…',
    answerType: 'text',
    writes: { kind: 'goal.title' },
    appliesTo: 'goal',
  },
  C2: {
    id: 'C2',
    stage: 'charter',
    prompt: 'Picture the day this is done. What can you point to that proves it?',
    shortPrompt: 'What proves it’s done?',
    helper: 'Something you could show someone. Add a number if there is one.',
    answerType: 'criterion',
    writes: { kind: 'goal.successCriterion' },
    appliesTo: 'goal',
    example: 'criterion',
  },
  C3: {
    id: 'C3',
    stage: 'charter',
    prompt: 'By when?',
    answerType: 'date',
    writes: { kind: 'goal.targetDate' },
    appliesTo: 'goal',
  },
  C4: {
    id: 'C4',
    stage: 'charter',
    prompt: 'Why does this matter to you?',
    helper:
      'Take a few seconds to picture it done first: where you are, what’s different, how it feels.',
    answerType: 'longText',
    writes: { kind: 'goal.charter.why' },
    appliesTo: 'goal',
    example: 'why',
  },
  C5: {
    id: 'C5',
    stage: 'charter',
    prompt: 'What’s the thing inside you most likely to get in the way?',
    helper: 'Picture the moment it shows up. Not the circumstances: a habit, a feeling, a pattern.',
    answerType: 'text',
    writes: { kind: 'goal.charter.obstacle' },
    appliesTo: 'goal',
    example: 'obstacle',
  },
  C6: {
    id: 'C6',
    stage: 'charter',
    prompt: 'When that shows up, what will you do?',
    helper: 'When ___, I will ___.',
    answerType: 'ifThen',
    writes: { kind: 'goal.charter.obstaclePlan' },
    appliesTo: 'goal',
    example: 'ifThen',
  },
  C7: {
    id: 'C7',
    stage: 'charter',
    prompt: 'What has to be true just before you reach this?',
    helper: 'Work backward from the finish line. One milestone is enough for now.',
    answerType: 'text',
    writes: { kind: 'createMilestone' },
    appliesTo: 'goal',
    example: 'milestone',
  },
  C8: {
    id: 'C8',
    stage: 'charter',
    prompt: 'What’s one action under an hour you could take this week toward that?',
    helper: 'Then: when and where will you do it? How will you know it’s done?',
    answerType: 'firstTask',
    writes: { kind: 'createTask', withIntention: true },
    appliesTo: 'milestone',
    example: 'firstTask',
  },

  // ---- Gap questions (SPEC §7.2) ----
  G1: {
    id: 'G1',
    stage: 'gap',
    prompt: 'What number or fact would prove this is done?',
    helper: 'A metric makes progress visible. “Revenue ≥ 2,000/month” beats “a real business”.',
    answerType: 'criterion',
    writes: { kind: 'goal.successCriterion' },
    appliesTo: 'goal',
    example: 'criterion',
  },
  G2: {
    id: 'G2',
    stage: 'gap',
    prompt: 'How many hours a week can you realistically give this? Which days?',
    shortPrompt: 'Weekly hours, by day?',
    helper: 'Realistic beats ambitious. The forecast is only as honest as this number.',
    answerType: 'capacity',
    writes: { kind: 'capacity' },
    appliesTo: 'goal',
  },
  G3: {
    id: 'G3',
    stage: 'gap',
    prompt: 'What’s the first concrete action toward “{milestone}”?',
    shortPrompt: 'First action toward “{milestone}”?',
    helper: 'A verb and an object. Add more than one if they come to mind.',
    answerType: 'taskList',
    writes: { kind: 'createTasks', milestoneId: '' },
    appliesTo: 'milestone',
    example: 'task',
  },
  G4: {
    id: 'G4',
    stage: 'gap',
    prompt: 'What has to be true just before “{milestone}”?',
    shortPrompt: 'What comes just before “{milestone}”?',
    helper: 'Working backward is easier than working forward.',
    answerType: 'text',
    writes: { kind: 'createMilestone', beforeMilestoneId: '' },
    appliesTo: 'milestone',
    example: 'milestone',
  },
  G5: {
    id: 'G5',
    stage: 'gap',
    prompt: 'How will you know “{task}” is done?',
    shortPrompt: 'Done when?',
    helper: 'Something observable: a file exists, a number is reached, a person said yes.',
    answerType: 'text',
    writes: { kind: 'task.definitionOfDone', taskId: '' },
    appliesTo: 'task',
    example: 'definitionOfDone',
  },
  G6: {
    id: 'G6',
    stage: 'gap',
    prompt: 'Best case, likely, worst case: how long will “{task}” take?',
    shortPrompt: 'Best / likely / worst for “{task}”?',
    helper: 'Hands-on time, not calendar time.',
    answerType: 'minutesRange',
    writes: { kind: 'task.estimateMinutes', taskId: '' },
    appliesTo: 'task',
    example: 'estimate',
    followUps: ['E2'],
  },
  G7: {
    id: 'G7',
    stage: 'gap',
    prompt: '“{task}” is big. Can it be split into smaller pieces?',
    shortPrompt: 'Split “{task}”?',
    helper: 'Pieces you could each finish in one sitting. They’ll run in the order you list them.',
    answerType: 'taskList',
    writes: { kind: 'task.split', taskId: '' },
    appliesTo: 'task',
    example: 'split',
  },
  G8: {
    id: 'G8',
    stage: 'gap',
    prompt: 'Does anything need to happen before “{task}”?',
    shortPrompt: 'Anything before “{task}”?',
    helper: 'Pick every task that has to finish first.',
    answerType: 'multiChoice',
    writes: { kind: 'task.dependencies', taskId: '' },
    appliesTo: 'task',
  },
  G9: {
    id: 'G9',
    stage: 'gap',
    prompt: 'How could you test “{assumption}” early and cheaply?',
    shortPrompt: 'Cheapest test of “{assumption}”?',
    helper: 'An action whose result would change your mind.',
    answerType: 'text',
    writes: { kind: 'createTask', testsAssumptionId: '' },
    appliesTo: 'assumption',
    example: 'assumptionTest',
  },
  G10: {
    id: 'G10',
    stage: 'gap',
    prompt: 'What needs to be done before “{stream}” starts earning?',
    helper: 'Pick a milestone, or a month if it starts on a date.',
    answerType: 'revenueStart',
    writes: { kind: 'revenue.start', streamId: '' },
    appliesTo: 'revenueStream',
  },
  G11: {
    id: 'G11',
    stage: 'gap',
    prompt: 'What money are you starting with?',
    helper: 'One account is enough to start. It becomes the runway account.',
    answerType: 'account',
    writes: { kind: 'createAccount' },
    appliesTo: 'goal',
  },
  G12: {
    id: 'G12',
    stage: 'premortem',
    prompt: 'It’s {deadline} and this goal failed. Write down the most likely reasons.',
    helper: 'Imagining the failure as already happened makes the reasons easier to see.',
    answerType: 'premortem',
    writes: { kind: 'goal.premortem' },
    appliesTo: 'goal',
    example: 'premortem',
  },

  // ---- Premortem ----
  P1: {
    id: 'P1',
    stage: 'premortem',
    prompt: 'It’s {deadline} and this goal failed. Write down the most likely reasons.',
    answerType: 'premortem',
    writes: { kind: 'goal.premortem' },
    appliesTo: 'goal',
    example: 'premortem',
  },

  // ---- Estimate ----
  E1: {
    id: 'E1',
    stage: 'estimate',
    prompt: 'Best case, likely, worst case?',
    answerType: 'minutesRange',
    writes: { kind: 'task.estimateMinutes', taskId: '' },
    appliesTo: 'task',
    example: 'estimate',
    followUps: ['E2'],
  },
  E2: {
    id: 'E2',
    stage: 'estimate',
    prompt: 'Think of the last similar thing you did. How long did it actually take?',
    shortPrompt: 'Last similar thing: actual minutes?',
    helper: 'Optional. It sits next to your estimate as a reference.',
    answerType: 'number',
    writes: { kind: 'task.referenceMinutes', taskId: '' },
    appliesTo: 'task',
  },
};

export const CHARTER_SEQUENCE = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'] as const;

export function question(id: string): Question {
  const q = QUESTIONS[id];
  if (!q) throw new Error(`Unknown question ${id}`);
  return q;
}

/** Fill {placeholders} in a prompt. Unknown placeholders are left as-is. */
export function fillPrompt(text: string, params: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => params[k] ?? m);
}

/** Prompt appropriate for a scaffold level. */
export function promptFor(
  q: Question,
  level: 1 | 2 | 3,
  params: Readonly<Record<string, string>> = {},
) {
  const text = level >= 2 && q.shortPrompt ? q.shortPrompt : q.prompt;
  return {
    prompt: fillPrompt(text, params),
    helper: level === 1 && q.helper ? fillPrompt(q.helper, params) : undefined,
  };
}

/** Bind object ids into a question's write target. */
export function bindQuestion(q: Question, objectId: string): Question {
  const w = { ...q.writes } as Record<string, unknown>;
  for (const k of ['taskId', 'milestoneId', 'streamId', 'testsAssumptionId', 'beforeMilestoneId']) {
    if (k in w) w[k] = objectId;
  }
  return { ...q, writes: w as unknown as Question['writes'] };
}
