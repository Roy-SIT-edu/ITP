import type { SoftConstraintPriority } from "./types";

function isActive(item: SoftConstraintPriority) {
  return item.isActive !== false;
}

function previewWeight(rank: number, total: number) {
  return total <= 0 ? 0 : Math.max(1, total - rank + 1) * 5;
}

export function rankSoftPriorities(priorities: SoftConstraintPriority[], previewWeights = false) {
  const normalized = priorities.map((item) => ({
    ...item,
    isActive: isActive(item),
  }));
  const activeItems = normalized.filter(isActive);
  const inactiveItems = normalized.filter((item) => !isActive(item));
  let activeRank = 0;

  return [...activeItems, ...inactiveItems].map((item) => {
    if (!isActive(item)) {
      return {
        ...item,
        rank: 0,
        weight: 0,
      };
    }

    activeRank += 1;
    return {
      ...item,
      rank: activeRank,
      weight: previewWeights ? previewWeight(activeRank, activeItems.length) : item.weight,
    };
  });
}

export function moveSoftPriority(priorities: SoftConstraintPriority[], index: number, direction: -1 | 1) {
  const displayList = rankSoftPriorities(priorities, true);
  const activeCount = displayList.filter(isActive).length;
  const item = displayList[index];
  const target = index + direction;

  if (!item || !isActive(item) || target < 0 || target >= activeCount) {
    return displayList;
  }

  const next = [...displayList];
  [next[index], next[target]] = [next[target], next[index]];
  return rankSoftPriorities(next, true);
}

export function setSoftPriorityActive(priorities: SoftConstraintPriority[], constraintCode: string, nextActive: boolean) {
  const displayList = rankSoftPriorities(priorities, true).map((item) =>
    item.constraint_code === constraintCode ? { ...item, isActive: nextActive } : item,
  );
  return rankSoftPriorities(displayList, true);
}
