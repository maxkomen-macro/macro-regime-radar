/**
 * Render-error containment. This is a class component because only class
 * lifecycles (getDerivedStateFromError / componentDidCatch) can catch an error
 * thrown during render; hooks cannot. The shell is meant to survive a screen
 * crash: one broken tab prints a note inside its own panel while the header,
 * nav, and every other tab keep working, instead of React unmounting the whole
 * root and leaving a blank page.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Card } from "../../components";

interface ErrorBoundaryProps {
  children: ReactNode;
  label?: string;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the browser console: the fallback is deliberately
    // quiet, so this is the only trace a developer gets.
    const what = this.props.label ?? "This screen";
    console.error(`[ErrorBoundary] ${what} failed to render`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <Card tone="risk">
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-body-s)",
            color: "var(--text)",
          }}
        >
          {`${this.props.label ?? "This screen"} hit a rendering error and could not paint.`}
        </div>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-caption)",
            color: "var(--text-muted)",
            marginTop: 4,
          }}
        >
          The rest of the terminal is unaffected; switching tabs re-mounts it. The error is logged to the browser
          console.
        </div>
      </Card>
    );
  }
}
