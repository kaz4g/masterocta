import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('renders Sources and Main regions', () => {
    render(
      <AppShell
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
      />,
    )
    expect(screen.getByLabelText('MasterOCTa workspace')).toHaveClass('mo-app-shell')
    expect(screen.getByText('Sources content')).toBeInTheDocument()
    expect(screen.getByText('Main content')).toBeInTheDocument()
    expect(screen.queryByText('Inspector content')).not.toBeInTheDocument()
  })

  it('renders Inspector when provided', () => {
    render(
      <AppShell
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
        inspector={<div>Inspector content</div>}
      />,
    )
    expect(screen.getByText('Inspector content')).toBeInTheDocument()
  })
})
