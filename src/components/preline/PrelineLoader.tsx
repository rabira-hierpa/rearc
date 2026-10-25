"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Preline's JS plugins scan the DOM once on load. With the App Router the DOM
 * changes on every client navigation without a page load, so components
 * rendered after that scan would be inert. Re-running `autoInit` on each
 * pathname change keeps them alive — a small but essential App Router gotcha.
 */
export function PrelineLoader() {
  const pathname = usePathname();

  useEffect(() => {
    async function init() {
      await import("preline");
      window.HSStaticMethods.autoInit();
    }
    void init();
    // `pathname` is not read by the effect — it IS the trigger. Re-running on
    // navigation is the entire point, so the "extra dependency" is deliberate.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [pathname]);

  return null;
}
