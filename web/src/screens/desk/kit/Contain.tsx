/**
 * A render error kept to one part of the Desk (Codex G1-8): the sidebar sits
 * outside each tab's own boundary, so a bad value in its TODAY card must not
 * replace the whole Desk. The part prints its fallback, in the Desk's words
 * and colors, and the error goes to the console like the shell's boundary.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

export default class Contain extends Component<{ children: ReactNode; fallback: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Contain] ${this.props.label} failed to render`, error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
