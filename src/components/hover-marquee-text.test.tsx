import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HoverMarqueeText } from "./hover-marquee-text";

describe("HoverMarqueeText", () => {
  it("keeps an ellipsized accessible copy and a separate animation runner", () => {
    const html = renderToStaticMarkup(<HoverMarqueeText text="C:\\Prime\\projects\\summary-burakov" />);
    expect(html).toContain('class="project-path-viewport"');
    expect(html).toContain('class="project-path-static"');
    expect(html).toContain('class="project-path-runner"');
    expect(html).toContain('aria-hidden="true"');
  });
});
