import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

export function ComposerTextPreview({ textarea, children }: { textarea: RefObject<HTMLTextAreaElement | null>; children: ReactNode }) {
  const mirror = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const input = textarea.current, layer = mirror.current;
    if (!input || !layer) return;
    let active = true;
    const scroll = () => { layer.scrollTop = input.scrollTop; layer.scrollLeft = input.scrollLeft; };
    const layout = () => {
      if (!active) return;
      const style = getComputedStyle(input);
      for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform', 'direction', 'tab-size', 'white-space', 'overflow-wrap', 'word-break', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']) {
        layer.style.setProperty(property, style.getPropertyValue(property));
      }
      layer.style.width = `${input.clientWidth}px`;
      layer.style.height = `${input.clientHeight}px`;
      scroll();
    };
    layout();
    const observer = new ResizeObserver(layout); observer.observe(input);
    input.addEventListener('scroll', scroll);
    window.addEventListener('resize', layout);
    void document.fonts.ready.then(layout);
    return () => { active = false; observer.disconnect(); input.removeEventListener('scroll', scroll); window.removeEventListener('resize', layout); };
  }, [textarea, children]);
  return <div ref={mirror} className="composer-text-preview" aria-hidden="true">{children}{'\u200b'}</div>;
}
