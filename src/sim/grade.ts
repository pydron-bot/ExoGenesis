/**
 * The Biosphere Report's grade: a letter for the planet health it sends (src/sim/planet.ts logs it, the top bar
 * shows the last one). Good is B or better: those reports count towards the story's `report-streak`.
 */
export const GRADES: [number, string][] = [[75, 'A'], [60, 'B'], [45, 'C'], [30, 'D'], [0, 'E']];
export const reportGrade = (health: number) => GRADES.find(([min]) => health >= min)![1];
/** B or better: the same line the Clause's `lead` reads as a high report (report-lead-*: planet ≥ 60). */
export const goodReport = (health: number) => health >= 60;
/** What the report sets for the story by itself (the editor's Story flow and Endings ledger count them as the game's). */
export const REPORT_FLAGS = ['biosphere-report', 'report-good'];
export const REPORT_COUNTERS = ['report-streak'];
