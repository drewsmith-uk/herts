import { Component, type ReactNode } from 'react';

/** A damaged message must not take away navigation, the composer or agent controls. */
export class MessageBoundary extends Component<{ children: ReactNode; revision: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; revision: string }>) {
    if (this.state.failed && previous.revision !== this.props.revision) this.setState({ failed: false });
  }
  render() { return this.state.failed ? <article className="message"><p role="alert">This message could not be displayed.</p></article> : this.props.children; }
}
