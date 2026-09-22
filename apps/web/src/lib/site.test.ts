import { describe, expect, it } from "vitest";

import { SITE_NAME, SITE_TITLE } from "./site";

describe("site branding", () => {
  it("uses Pianissimo", () => {
    expect(SITE_NAME).toBe("Pianissimo");
    expect(SITE_TITLE).toContain("Pianissimo");
  });
});
