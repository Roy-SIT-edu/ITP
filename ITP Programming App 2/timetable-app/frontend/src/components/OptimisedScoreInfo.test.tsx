import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import OptimisedScoreInfo from "./OptimisedScoreInfo";

describe("OptimisedScoreInfo", () => {
  it("renders the open popover outside an overflow-clipped card", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <section className="review-command-card">
        <OptimisedScoreInfo />
      </section>,
    );

    const trigger = screen.getByRole("button", { name: "How the optimised score is calculated" });
    await user.click(trigger);

    const popover = screen.getByRole("note");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(popover.parentElement).toBe(document.body);
    expect(container).not.toContainElement(popover);
  });

  it("closes the popover with Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<OptimisedScoreInfo />);

    const trigger = screen.getByRole("button", { name: "How the optimised score is calculated" });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
