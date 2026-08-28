import { type HTMLAttributes, type ReactNode } from 'react'
import { SplitPane } from '../design-system'
import './AppShell.css'

export interface AppShellProps extends HTMLAttributes<HTMLElement> {
  /** Left Sources column (root / set navigation chrome). */
  sources: ReactNode
  /** Center Library / Project workspace. */
  main: ReactNode
  /** Optional right Inspector; omitted until UI4. */
  inspector?: ReactNode
  /** Sources pane width % when inspector is hidden. */
  sourcesSize?: number
  onSourcesSizeChange?: (percent: number) => void
}

/**
 * Next-generation three-region shell (Sources | Main | Inspector).
 * Presentation only — feature state stays in callers.
 */
export function AppShell({
  sources,
  main,
  inspector,
  sourcesSize = 28,
  onSourcesSizeChange,
  className,
  ...rest
}: AppShellProps) {
  const merged = ['mo-app-shell', className].filter(Boolean).join(' ')
  const showInspector = inspector != null

  return (
    <section className={merged} aria-label="MasterOCTa workspace" {...rest}>
      <SplitPane
        className="mo-app-shell__body"
        primarySize={sourcesSize}
        onPrimarySizeChange={onSourcesSizeChange}
        minPrimary={18}
        maxPrimary={showInspector ? 36 : 42}
      >
        <SplitPane.Primary className="mo-app-shell__sources">
          {sources}
        </SplitPane.Primary>
        <SplitPane.Divider />
        <SplitPane.Secondary>
          {showInspector ? (
            <SplitPane
              className="mo-app-shell__body"
              primarySize={72}
              minPrimary={55}
              maxPrimary={85}
            >
              <SplitPane.Primary className="mo-app-shell__main">
                {main}
              </SplitPane.Primary>
              <SplitPane.Divider />
              <SplitPane.Secondary className="mo-app-shell__inspector">
                {inspector}
              </SplitPane.Secondary>
            </SplitPane>
          ) : (
            <div className="mo-app-shell__main">{main}</div>
          )}
        </SplitPane.Secondary>
      </SplitPane>
    </section>
  )
}
