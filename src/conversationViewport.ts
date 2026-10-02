/** Scroll requests go to the history controller, including disclosure and attention controls. */
export function conversationViewport(element: Element | null) { return element?.closest<HTMLElement>('.conversation-scroll') || null; }
export function requestConversationPosition(element: Element | null, kind: 'reveal' | 'hold' | 'restore') {
  conversationViewport(element)?.dispatchEvent(new CustomEvent('conversation-position', { detail: { element, kind } }));
}
