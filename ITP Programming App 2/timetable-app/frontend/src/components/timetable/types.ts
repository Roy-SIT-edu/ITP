export const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export type MoveDraft = {
  day: string;
  start_time: string;
  end_time: string;
  room_code: string;
};

export type PlannerSlot = {
  key: string;
  start_time: string;
  end_time: string;
  label: string;
};
