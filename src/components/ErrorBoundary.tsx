import { Component, type ReactNode } from 'react';
import { logError } from '../lib/errors';
import { isChunkLoadError, reportStale } from '../lib/staleVersion';

/** If a part of the interface crashes, it is redrawn instead of the whole app going blank; the project is untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode; area: string }, { failed: string | null; n: number }> {
  state = { failed: null as string | null, n: 0 };
  static getDerivedStateFromError(e: Error) { return { failed: e.message }; }
  componentDidCatch(e: Error) {
    // a window whose file is gone from the server (Forge published again): the reload proposal, not a crash
    if (isChunkLoadError(e)) { reportStale(e); return; }
    logError('interface:' + this.props.area, e);
  }
  render() {
    if (!this.state.failed) return <div key={this.state.n} style={{ display: 'contents' }}>{this.props.children}</div>;
    if (isChunkLoadError(this.state.failed)) return null;
    return (
      <div className="crash">
        <strong>Cette zone a rencontré un problème.</strong>
        <span>Ton projet est sauvegardé et intact.</span>
        <button className="btn sm primary" onClick={() => this.setState((s) => ({ failed: null, n: s.n + 1 }))}>Réafficher</button>
      </div>
    );
  }
}
