export type TimetableReviewFilters = {
  source: string;
  query: string;
  issue: string;
  classType: string;
  programme: string;
  group: string;
  staff: string;
  room: string;
  day: string;
};

export const emptyTimetableReviewFilters: TimetableReviewFilters = {
  source: "",
  query: "",
  issue: "",
  classType: "",
  programme: "",
  group: "",
  staff: "",
  room: "",
  day: "",
};

export function conflictSelectionFilters(programme: string | null): TimetableReviewFilters {
  return { ...emptyTimetableReviewFilters, programme: programme ?? "" };
}
