import {useEffect,useRef} from 'react';
import {useSensor,useSensors,MouseSensor,TouchSensor,KeyboardSensor} from '@dnd-kit/core';
import {sortableKeyboardCoordinates} from '@dnd-kit/sortable';
export function useHoldSensors() {
  return useSensors(useSensor(MouseSensor, { activationConstraint: { delay: 450, tolerance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 450, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
}
export function useDragClickGuard() {
  const guard = useRef({ active: false, until: 0 });
  useEffect(() => {
    const down = () => { if (!guard.current.active) guard.current.until = 0; };
    const click = (event: MouseEvent) => {
      if (event.detail !== 0 && (guard.current.active || Date.now() < guard.current.until)) { event.preventDefault(); event.stopPropagation(); }
    };
    // dnd-kit stops click propagation at the document after activation, so a
    // React click handler never gets to cancel an anchor's default navigation.
    // Register before the sensor and suppress only the release click; a fresh
    // pointer gesture immediately restores normal links and buttons.
    document.addEventListener('pointerdown', down, true); document.addEventListener('click', click, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('click', click, true); };
  }, []);
  return { start: () => { guard.current = { active: true, until: 0 }; }, end: () => { guard.current = { active: false, until: Date.now()+700 }; } };
}
// Buttons and editable fields keep their ordinary gestures. A title link opens
// on a tap and can start a drag only after a stationary hold.
export function holdListeners(listeners: Record<string, Function> | undefined) {
  return Object.fromEntries(Object.entries(listeners || {}).map(([name, listener]) => [name, (event: any) => {
    if (event.target instanceof Element && (event.target.closest('button,input,textarea,select,[contenteditable="true"]') || (name === 'onKeyDown' && event.target.closest('a')))) return;
    listener(event);
  }]));
}
