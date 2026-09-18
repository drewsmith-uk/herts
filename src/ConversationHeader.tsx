import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function ConversationHeader({ children }: { children: ReactNode }) {
  const header = useRef<HTMLElement>(null), start = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  useLayoutEffect(() => {
    const update = () => document.documentElement.style.setProperty('--conversation-header-space', `${header.current!.offsetHeight + (document.querySelector('.topbar')?.clientHeight || 0) + 12}px`);
    update();
    const observer = new ResizeObserver(update); observer.observe(header.current!);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--conversation-header-space'); };
  }, []);
  useEffect(() => {
    let movement = 0, touchY: number | undefined, scrollbar = false, previousY = window.scrollY;
    function move(delta: number, target: EventTarget | null) {
      if (!delta) return;
      if (header.current?.contains(document.activeElement) || (start.current?.getBoundingClientRect().top || 0) > 0) {
        movement = 0; setHidden(false); return;
      }
      // Scrolling a tool output, title or other nested scroller should not dismiss the page header.
      for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight && (delta > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight : el.scrollTop > 0)) return;
      }
      movement = Math.sign(movement) === Math.sign(delta) ? movement + delta : delta;
      if (Math.abs(movement) >= 24) { setHidden(movement > 0); movement = 0; }
    }
    // Only deliberate scrolling changes visibility. Opening history, streaming and expanding
    // activity all scroll programmatically and must keep the current header state.
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) move(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1), event.target); };
    const touchStart = (event: TouchEvent) => { touchY = event.touches.length === 1 ? event.touches[0].clientY : undefined; };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) { touchY = undefined; return; }
      const y = event.touches[0].clientY;
      if (touchY !== undefined) move(touchY - y, event.target);
      touchY = y;
    };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]'))) return;
      if (['ArrowDown','PageDown','End'].includes(event.key) || (event.key === ' ' && !event.shiftKey)) move(40, event.target);
      if (['ArrowUp','PageUp','Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) move(-40, event.target);
    };
    const pointerDown = (event: PointerEvent) => { scrollbar = event.clientX >= document.documentElement.clientWidth; previousY = window.scrollY; };
    const pointerUp = () => { scrollbar = false; };
    const scroll = () => { if (scrollbar) move(window.scrollY - previousY, null); previousY = window.scrollY; if (window.scrollY === 0) setHidden(false); };
    window.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('touchstart', touchStart, { passive: true });
    window.addEventListener('touchmove', touchMove, { passive: true });
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', pointerDown, { passive: true });
    window.addEventListener('pointerup', pointerUp, { passive: true });
    window.addEventListener('scroll', scroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', wheel); window.removeEventListener('touchstart', touchStart); window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('scroll', scroll);
    };
  }, []);
  return <><div ref={start} className="conversation-header-start"/><header ref={header} className={`conversation-page-header ${hidden ? 'is-hidden' : ''}`} onFocusCapture={() => setHidden(false)}>{children}</header></>;
}
