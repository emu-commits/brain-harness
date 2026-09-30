import { fixedClock } from '../../src/core/util/clock';
import { sequentialIdGen } from '../../src/core/util/ids';
import { emptyWorkspace, newGoal, newMilestone, newTask } from '../../src/core/model/factories';
import type { Capacity, Dependency, Task, Workspace } from '../../src/core/model/types';

export const NOW = '2026-01-05T09:00:00.000Z';
export const TODAY = '2026-01-05';

export function setup(now = NOW) {
  const ids = sequentialIdGen();
  const clock = fixedClock(now);
  return { ids, clock };
}

/** A goal with one milestone and the given tasks (chained if `chain`). */
export function sampleWorkspace(
  opts: { tasks?: Partial<Task>[]; chain?: boolean; minutesPerDay?: number } = {},
) {
  const { ids, clock } = setup();
  const ws = emptyWorkspace();
  const goal = newGoal(ids, clock, 'Open a pottery studio', '2026-06-30');
  goal.charter.why = 'So I make things with my hands';
  goal.charter.obstaclePlan = 'When I stall, I will do five minutes';
  const m = newMilestone(ids, goal.id, 'Studio space secured', 0);
  const tasks: Task[] = (opts.tasks ?? [{ title: 'A' }, { title: 'B' }]).map((p, i) =>
    newTask(ids, clock, goal.id, p.title ?? `T${i}`, {
      milestoneId: m.id,
      estimateMinutes: { low: 30, base: 60, high: 120 },
      definitionOfDone: 'done',
      createdAt: `2026-01-01T00:00:0${i}.000Z`,
      ...p,
    }),
  );
  const deps: Dependency[] = [];
  if (opts.chain) {
    for (let i = 1; i < tasks.length; i++)
      deps.push({
        id: ids.next(),
        fromTaskId: tasks[i - 1]!.id,
        toTaskId: tasks[i]!.id,
        lagDays: 0,
      });
  }
  const mpd = opts.minutesPerDay ?? 60;
  const cap: Capacity = { goalId: goal.id, minutesByWeekday: [mpd, mpd, mpd, mpd, mpd, mpd, mpd] };
  const out: Workspace = {
    ...ws,
    goals: [goal],
    milestones: [m],
    tasks,
    dependencies: deps,
    capacities: [cap],
  };
  return { ws: out, goal, milestone: m, tasks, ids, clock };
}
