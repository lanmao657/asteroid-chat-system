"use client";

import { useEffect, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { AuthFormCard } from "./auth-form-card";
import {
  lockVerticalMotion,
  normalizePointer,
  scaleMotion,
  type MotionVector,
} from "./auth-shell-motion";
import styles from "./auth-shell.module.css";

type AuthMode = "login" | "register";

const zeroMotion: MotionVector = { x: 0, y: 0 };

function isSameMotion(a: MotionVector, b: MotionVector) {
  return a.x === b.x && a.y === b.y;
}

const sceneCopy = {
  login: {
    eyebrow: "北辰知识助手",
    title: "登录",
    description: "进入工作区",
  },
  register: {
    eyebrow: "北辰知识助手",
    title: "注册",
    description: "创建账号",
  },
} as const;

function createTranslateStyle(x: number, y: number, scale = 1): CSSProperties {
  return {
    transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
  };
}

function createOffsetStyle(x: number, y: number): CSSProperties {
  return {
    translate: `${x}px ${y}px`,
  };
}

function createPupilStyle(x: number, y: number): CSSProperties {
  return {
    transform: `translate3d(${x}px, ${y}px, 0)`,
  };
}

export function AuthShell({ mode }: { mode: AuthMode }) {
  const [pointer, setPointer] = useState<MotionVector>(zeroMotion);
  const [canTrackPointer, setCanTrackPointer] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [pending, setPending] = useState(false);

  const copy = sceneCopy[mode];
  const eyesClosed = passwordFocused;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 981px) and (hover: hover) and (pointer: fine)");
    const syncPointerCapability = () => {
      const { matches } = mediaQuery;

      setCanTrackPointer((current) => (current === matches ? current : matches));

      if (!matches) {
        setPointer((current) => (isSameMotion(current, zeroMotion) ? current : zeroMotion));
      }
    };

    syncPointerCapability();
    mediaQuery.addEventListener("change", syncPointerCapability);

    return () => {
      mediaQuery.removeEventListener("change", syncPointerCapability);
    };
  }, []);

  const sceneShift = canTrackPointer && !pending ? scaleMotion(pointer, 12, 10) : zeroMotion;
  const purpleShift = canTrackPointer && !pending ? scaleMotion(pointer, 7, 5) : zeroMotion;
  const blackShift = canTrackPointer && !pending ? scaleMotion(pointer, 4, 3) : zeroMotion;
  const orangeShift = canTrackPointer && !pending ? scaleMotion(pointer, 10, 4) : zeroMotion;
  const yellowShift = canTrackPointer && !pending ? scaleMotion(pointer, 5, 3) : zeroMotion;
  const stageShift = lockVerticalMotion(sceneShift);
  const purpleBodyShift = lockVerticalMotion(purpleShift);
  const blackBodyShift = lockVerticalMotion(blackShift);
  const orangeBodyShift = lockVerticalMotion(orangeShift);
  const yellowBodyShift = lockVerticalMotion(yellowShift);

  const purplePupil = canTrackPointer && !pending ? scaleMotion(pointer, 4, 3) : zeroMotion;
  const blackPupil = canTrackPointer && !pending ? scaleMotion(pointer, 3, 2) : zeroMotion;
  const orangePupil = canTrackPointer && !pending ? scaleMotion(pointer, 7, 3.5) : zeroMotion;
  const yellowPupil = canTrackPointer && !pending ? scaleMotion(pointer, 5, 2.5) : zeroMotion;

  return (
    <div
      className={cn(styles.shell, eyesClosed && styles.eyesClosed, pending && styles.pendingMode)}
      onMouseLeave={() => {
        setPointer((current) => (isSameMotion(current, zeroMotion) ? current : zeroMotion));
      }}
      onMouseMove={(event) => {
        if (!canTrackPointer || pending) {
          return;
        }

        const rect = event.currentTarget.getBoundingClientRect();
        const nextPointer = normalizePointer({
          clientX: event.clientX,
          clientY: event.clientY,
          rect,
        });

        setPointer((current) => (isSameMotion(current, nextPointer) ? current : nextPointer));
      }}
    >
      <section aria-hidden="true" className={styles.scene}>
        <div className={styles.blobOne} style={createTranslateStyle(sceneShift.x * -0.8, sceneShift.y * -0.7)} />
        <div className={styles.blobTwo} style={createTranslateStyle(sceneShift.x * 0.5, sceneShift.y * 0.45)} />
        <div className={styles.gridOverlay} />

        <div className={styles.sceneInner}>
          <header className={styles.sceneHeader}>
            <span className={styles.eyebrow}>{copy.eyebrow}</span>
            <h1 className={styles.sceneTitle}>{copy.title}</h1>
            <p className={styles.sceneDescription}>{copy.description}</p>
          </header>

          <div className={styles.sceneStage}>
            <div className={styles.charactersWrap} style={createTranslateStyle(stageShift.x, stageShift.y)}>
              <div className={styles.characters}>
                <div
                  className={cn(styles.character, styles.charPurple, styles.floatSlow)}
                  style={createOffsetStyle(purpleBodyShift.x, purpleBodyShift.y)}
                >
                  <div className={cn(styles.eyesWrap, styles.purpleEyes)}>
                    <span className={styles.eyeball}>
                      <span className={styles.pupil} style={createPupilStyle(purplePupil.x, purplePupil.y)} />
                    </span>
                    <span className={styles.eyeball}>
                      <span className={styles.pupil} style={createPupilStyle(purplePupil.x, purplePupil.y)} />
                    </span>
                  </div>
                </div>

                <div
                  className={cn(styles.character, styles.charBlack, styles.floatFast)}
                  style={createOffsetStyle(blackBodyShift.x, blackBodyShift.y)}
                >
                  <div className={cn(styles.eyesWrap, styles.blackEyes)}>
                    <span className={styles.eyeball}>
                      <span className={styles.pupil} style={createPupilStyle(blackPupil.x, blackPupil.y)} />
                    </span>
                    <span className={styles.eyeball}>
                      <span className={styles.pupil} style={createPupilStyle(blackPupil.x, blackPupil.y)} />
                    </span>
                  </div>
                </div>

                <div
                  className={cn(styles.character, styles.charOrange, styles.floatFast)}
                  style={createOffsetStyle(orangeBodyShift.x, orangeBodyShift.y)}
                >
                  <div className={cn(styles.eyesWrap, styles.orangeEyes)}>
                    <span className={styles.eyeball}>
                      <span className={styles.pupil} style={createPupilStyle(orangePupil.x, orangePupil.y)} />
                    </span>
                    <span className={styles.eyeball}>
                      <span className={styles.pupil} style={createPupilStyle(orangePupil.x, orangePupil.y)} />
                    </span>
                  </div>
                </div>

                <div
                  className={cn(styles.character, styles.charYellow, styles.floatSlow)}
                  style={createOffsetStyle(yellowBodyShift.x, yellowBodyShift.y)}
                >
                  <div className={cn(styles.eyesWrap, styles.yellowEyes)}>
                    <span className={styles.eyeball}>
                      <span className={styles.pupil} style={createPupilStyle(yellowPupil.x, yellowPupil.y)} />
                    </span>
                    <span className={styles.eyeball}>
                      <span className={styles.pupil} style={createPupilStyle(yellowPupil.x, yellowPupil.y)} />
                    </span>
                  </div>
                  <div className={styles.mouth} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelInner}>
          <AuthFormCard
            mode={mode}
            onPasswordFocusChange={setPasswordFocused}
            onPendingChange={setPending}
          />
        </div>
      </section>
    </div>
  );
}
