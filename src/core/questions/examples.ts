// Curated static examples of *form*, never content for the user's goal (SPEC §7.4).
// Revealed only after the user submits an attempt or taps "I'm stuck".

export interface Example {
  id: string;
  /** What makes a good answer, in one line. */
  lesson: string;
  /** Generic illustrations, deliberately unrelated to any particular goal. */
  samples: string[];
}

export const EXAMPLES: Record<string, Example> = {
  criterion: {
    id: 'criterion',
    lesson: 'Good proof is something another person could check without asking you.',
    samples: [
      'A signed lease for a studio space (metric: leases signed, target 1)',
      'Ten paying customers in one month (metric: paying customers, target 10)',
      'A finished draft of 60,000 words (metric: words, target 60000)',
    ],
  },
  why: {
    id: 'why',
    lesson: 'A strong “why” names what changes for you, not what sounds impressive.',
    samples: ['So I stop dreading Sunday nights.', 'So my kids see me finish something hard.'],
  },
  obstacle: {
    id: 'obstacle',
    lesson: 'Name an inner pattern you recognize, not an outside circumstance.',
    samples: ['I avoid tasks when I’m not sure how to start.', 'I polish instead of shipping.'],
  },
  ifThen: {
    id: 'ifThen',
    lesson: 'Make the “when” a moment you’d notice, and the “then” a tiny first move.',
    samples: [
      'When I catch myself opening email instead, I will close it and write one sentence.',
      'When I feel it isn’t good enough, I will send it anyway and note what I’d change.',
    ],
  },
  milestone: {
    id: 'milestone',
    lesson: 'A milestone is a state of the world, not an activity.',
    samples: [
      '“The prototype works end to end” rather than “build the prototype”.',
      '“Three venues have said yes”',
    ],
  },
  firstTask: {
    id: 'firstTask',
    lesson: 'Small enough that starting feels easy; concrete enough that done is obvious.',
    samples: [
      'List five people to ask, Tuesday 8pm at the kitchen table. Done when the list has five names.',
    ],
  },
  task: {
    id: 'task',
    lesson: 'Start with a verb. If you can’t picture doing it, it’s still a milestone.',
    samples: ['Email three suppliers for quotes', 'Sketch the floor plan on paper'],
  },
  definitionOfDone: {
    id: 'definitionOfDone',
    lesson: 'Done is observable: a file, a number, a sent message, a yes.',
    samples: ['Draft saved and shared with one reader', 'Spreadsheet has all 12 months filled in'],
  },
  estimate: {
    id: 'estimate',
    lesson: 'The worst case is the one where two things go wrong, not the apocalypse.',
    samples: ['30 / 60 / 150 minutes', '2 / 3 / 6 hours'],
  },
  split: {
    id: 'split',
    lesson: 'Split along natural pauses: research, draft, check, send.',
    samples: ['“Write the report” → Outline · Draft sections 1–3 · Draft 4–6 · Edit · Send'],
  },
  assumptionTest: {
    id: 'assumptionTest',
    lesson: 'The cheapest test is often asking someone, or trying a tiny version.',
    samples: [
      'Post one listing and count replies in a week',
      'Ask three potential buyers what they pay today',
    ],
  },
  premortem: {
    id: 'premortem',
    lesson: 'Specific reasons beat vague ones. “Ran out of money in month 4” beats “money”.',
    samples: [
      'I stopped working on it after the first setback',
      'The approval took three months, not three weeks',
    ],
  },
};
