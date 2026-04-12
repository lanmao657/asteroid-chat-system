import { describe, expect, it } from "vitest";

import { clampMotion, lockVerticalMotion, normalizePointer, scaleMotion } from "./auth-shell-motion";

describe("auth shell motion helpers", () => {
  it("normalizes the pointer inside a rectangle", () => {
    expect(
      normalizePointer({
        clientX: 100,
        clientY: 50,
        rect: {
          left: 0,
          top: 0,
          width: 200,
          height: 100,
        },
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("clamps pointer values to the supported range", () => {
    expect(
      normalizePointer({
        clientX: -80,
        clientY: 260,
        rect: {
          left: 0,
          top: 0,
          width: 200,
          height: 100,
        },
      }),
    ).toEqual({ x: -1, y: 1 });
  });

  it("returns zero motion for empty rectangles", () => {
    expect(
      normalizePointer({
        clientX: 10,
        clientY: 10,
        rect: {
          left: 0,
          top: 0,
          width: 0,
          height: 100,
        },
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("keeps scaled motion within pupil bounds", () => {
    expect(scaleMotion({ x: 1.6, y: -1.4 }, 6, 4)).toEqual({ x: 6, y: -4 });
    expect(clampMotion(12, 4)).toBe(4);
    expect(clampMotion(-12, 4)).toBe(-4);
  });

  it("locks mascot motion to the baseline", () => {
    expect(lockVerticalMotion({ x: 7, y: -5 })).toEqual({ x: 7, y: 0 });
    expect(lockVerticalMotion({ x: -3, y: 9 })).toEqual({ x: -3, y: 0 });
  });
});
