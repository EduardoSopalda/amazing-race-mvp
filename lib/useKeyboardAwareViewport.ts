"use client";

import { useEffect } from "react";

/**
 * Keeps the --app-vh custom property in sync with the real visible
 * viewport height via window.visualViewport - unlike CSS dvh/svh, which
 * only account for browser chrome (address bar, toolbars), visualViewport
 * also shrinks when the on-screen keyboard opens. Without this, a
 * focused input's keyboard can cover the primary action button with no
 * layout signal that it needs to move or scroll, since dvh/svh never
 * change when the keyboard appears.
 *
 * Falls back to window.innerHeight on browsers without visualViewport
 * support; .phone/.rig's own `height: 100dvh` stays as the CSS fallback
 * for the instant before this effect runs on first paint.
 */
export function useKeyboardAwareViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;

    function update() {
      const h = vv?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${h}px`);
    }

    update();
    vv?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
  }, []);
}
