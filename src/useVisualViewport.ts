import { useEffect } from 'react';

export function useVisualViewport() {
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--viewport-height', `${view.height}px`);
        document.documentElement.style.setProperty('--viewport-top', `${view.offsetTop}px`);
        const editor = document.activeElement?.matches('textarea, input, [contenteditable="true"]');
        document.body.classList.toggle('keyboard-open', !!editor && window.innerHeight - view.height > 120);
      });
    };
    view.addEventListener('resize', update); view.addEventListener('scroll', update); document.addEventListener('focusin', update); document.addEventListener('focusout', update); update();
    return () => { cancelAnimationFrame(frame); view.removeEventListener('resize', update); view.removeEventListener('scroll', update); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); document.body.classList.remove('keyboard-open'); };
  }, []);
}
