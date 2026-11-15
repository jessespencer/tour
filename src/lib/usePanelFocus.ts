import { useEffect, type RefObject } from 'react';

/** Move focus into a panel once, when it opens — never on later content
 *  changes, and never away from the controls that drive the panel (stepper,
 *  leg rail, timeline), so keyboard stepping keeps its place. */
export function usePanelFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const active = document.activeElement;
    if (active?.closest('.stepper, .leg-rail, .scrubber')) return;
    ref.current?.focus();
  }, [ref]);
}
