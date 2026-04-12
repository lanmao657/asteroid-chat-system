export type MotionVector = {
  x: number;
  y: number;
};

type PointerRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type NormalizePointerArgs = {
  clientX: number;
  clientY: number;
  rect: PointerRect;
};

export function clampMotion(value: number, max: number) {
  return Math.min(max, Math.max(-max, value));
}

export function normalizePointer({ clientX, clientY, rect }: NormalizePointerArgs): MotionVector {
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0 };
  }

  const normalizedX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const normalizedY = ((clientY - rect.top) / rect.height) * 2 - 1;

  return {
    x: clampMotion(normalizedX, 1),
    y: clampMotion(normalizedY, 1),
  };
}

export function scaleMotion(pointer: MotionVector, maxX: number, maxY = maxX): MotionVector {
  return {
    x: clampMotion(pointer.x * maxX, maxX),
    y: clampMotion(pointer.y * maxY, maxY),
  };
}

export function lockVerticalMotion(pointer: MotionVector): MotionVector {
  return {
    x: pointer.x,
    y: 0,
  };
}
