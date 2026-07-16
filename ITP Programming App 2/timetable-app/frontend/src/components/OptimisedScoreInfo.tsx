import { Info } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ScheduleQuality } from "../types";

type Props = {
  quality?: ScheduleQuality;
};

type PopoverPosition = {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
};

const POPOVER_WIDTH = 360;
const POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 12;
const MIN_ANCHORED_HEIGHT = 96;

export default function OptimisedScoreInfo({ quality }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;

      const triggerRect = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const width = Math.max(0, Math.min(POPOVER_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2));
      const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
      const left = Math.min(Math.max(VIEWPORT_MARGIN, triggerRect.right - width), maxLeft);
      const heightBelow = viewportHeight - triggerRect.bottom - POPOVER_GAP - VIEWPORT_MARGIN;
      const heightAbove = triggerRect.top - POPOVER_GAP - VIEWPORT_MARGIN;
      const naturalHeight = popover.scrollHeight;
      const placeBelow = heightBelow >= Math.min(naturalHeight, MIN_ANCHORED_HEIGHT) || heightBelow >= heightAbove;
      const availableHeight = placeBelow ? heightBelow : heightAbove;

      if (availableHeight < MIN_ANCHORED_HEIGHT) {
        setPosition({
          left,
          maxHeight: Math.max(0, viewportHeight - VIEWPORT_MARGIN * 2),
          top: VIEWPORT_MARGIN,
          width,
        });
        return;
      }

      const maxHeight = Math.max(0, availableHeight);
      setPosition({
        left,
        maxHeight,
        top: placeBelow
          ? triggerRect.bottom + POPOVER_GAP
          : Math.max(VIEWPORT_MARGIN, triggerRect.top - POPOVER_GAP - Math.min(naturalHeight, maxHeight)),
        width,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`optimised-score-info ${open ? "open" : ""}`}>
      <button
        aria-controls={popoverId}
        aria-expanded={open}
        aria-label="How the optimised score is calculated"
        className="optimised-score-trigger"
        onClick={() => {
          setPosition(null);
          setOpen((current) => !current);
        }}
        ref={triggerRef}
        title="How the optimised score is calculated"
        type="button"
      >
        <Info size={15} />
      </button>
      {open &&
        createPortal(
          <div
            className="optimised-score-popover"
            id={popoverId}
            ref={popoverRef}
            role="note"
            style={
              position
                ? {
                    left: position.left,
                    maxHeight: position.maxHeight,
                    top: position.top,
                    width: position.width,
                  }
                : { visibility: "hidden" }
            }
          >
            <strong>How the score is calculated</strong>
            <p>The score starts at 100. Points are deducted for:</p>
            <ul>
              <li>hard conflicts, up to 70 points (18 each, plus their affected-session impact)</li>
              <li>soft warnings per scheduled session, up to 35 points</li>
              <li>the share of sessions affected by issues, up to 20 points</li>
              <li>missed preferences, weighted by priority per session, up to 15 points</li>
            </ul>
            <div className="optimised-score-formula">
              100 - hard penalty - warning penalty - affected-session penalty - preference penalty
            </div>
            <p>If any hard conflict remains, the final score is capped at 49. A higher score is better.</p>
            {quality && (
              <div className="optimised-score-current">
                This run: {quality.hard_issue_count} hard, {quality.soft_warning_count} soft, and{" "}
                {quality.affected_session_percent}% of sessions affected.
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
