import { useMemo } from 'react';
import { buildForecastInputs, runForecast } from '../core/engines/scenarios';
import type { Forecast, ForecastInputs } from '../core/engines/scenarios';
import { detectStuck } from '../core/harness/stuck';
import type { StuckReason } from '../core/harness/stuck';
import { depsOfGoal, getSettings, tasksOfGoal } from '../core/model/factories';
import type { ID } from '../core/model/types';
import { useStore } from './store';

/** Forecast for the active goal, recomputed whenever the model or the date changes. */
export function useForecast(): { inputs: ForecastInputs | null; forecast: Forecast | null } {
  const { ws, goal, clock } = useStore();
  const today = clock.today();
  const inputs = useMemo(
    () => (goal ? buildForecastInputs(ws, goal.id, today) : null),
    [ws, goal, today],
  );
  const forecast = useMemo(() => (inputs ? runForecast(inputs) : null), [inputs]);
  return { inputs, forecast };
}

export function useStuck(): Record<ID, StuckReason[]> {
  const { ws, goal, clock } = useStore();
  const now = clock.now().slice(0, 13); // recompute at most hourly
  return useMemo(
    () => (goal ? detectStuck(ws, goal.id, clock.now(), getSettings(ws).stuck) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws, goal, now],
  );
}

export function useGoalTasks() {
  const { ws, goal } = useStore();
  return useMemo(
    () =>
      goal
        ? { tasks: tasksOfGoal(ws, goal.id), deps: depsOfGoal(ws, goal.id) }
        : { tasks: [], deps: [] },
    [ws, goal],
  );
}
