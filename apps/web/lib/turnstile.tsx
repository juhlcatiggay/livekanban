"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Unset in development and tests: board creation then needs no challenge (the Worker skips it too). */
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoad: Promise<void> | null = null;
function loadScript(): Promise<void> {
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoad = null;
      reject(new Error("Couldn't load the verification script"));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

/**
 * Turnstile error codes: 400xxx and 110xxx are configuration problems (wrong
 * key, hostname not allowed), which only the site owner can fix.
 * https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
 */
function describeError(code: string | null): string | null {
  if (!code) return null;
  if (code === "script") return "Verification couldn't load. Disable content blockers for this site or try another browser.";
  if (code === "400020") return "Verification is misconfigured: the site key isn't valid (Turnstile error 400020).";
  if (code.startsWith("110200")) return "Verification is misconfigured: this hostname isn't allowed for the site key (Turnstile error 110200).";
  if (code.startsWith("400") || code.startsWith("110")) return `Verification is misconfigured (Turnstile error ${code}).`;
  return `Verification failed (Turnstile error ${code}). Reload the page to try again.`;
}

/**
 * Cloudflare Turnstile for board creation. Uses "interaction-only"
 * appearance, so most visitors never see a challenge. Tokens are single-use:
 * call reset() after each request.
 */
export function useTurnstile() {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  /** Turnstile error code, or "script" if the script itself couldn't load. */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    loadScript().then(
      () => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: SITE_KEY,
          appearance: "interaction-only",
          callback: (t: string) => setToken(t),
          "expired-callback": () => setToken(null),
          // Returning true tells Turnstile we've handled (and will show) the error.
          "error-callback": (code: string) => {
            setError(String(code));
            return true;
          },
        });
      },
      () => !cancelled && setError("script"),
    );
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, []);

  return {
    /** True when a request can be sent now (no challenge configured, or a token is ready). */
    ready: !SITE_KEY || token !== null,
    /** Why verification can't run, for display; null when fine. */
    problem: describeError(error),
    token,
    reset,
    widget: SITE_KEY ? <div ref={container} /> : null,
  };
}
