// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CoverPlaceholder } from '../../../src/components/CoverPlaceholder'

describe('CoverPlaceholder', () => {
  it('renders the icon and label', () => {
    render(<CoverPlaceholder icon={<span>♪</span>} label="无封面" />)

    expect(screen.getByText('无封面')).toBeInTheDocument()
    expect(screen.getByText('♪')).toBeInTheDocument()
  })

  it('renders only the icon when label is omitted', () => {
    render(<CoverPlaceholder icon={<span>♪</span>} />)

    expect(screen.getByText('♪')).toBeInTheDocument()
    expect(screen.queryByText('无封面')).not.toBeInTheDocument()
  })

  it('renders only the label when icon is omitted', () => {
    const { container } = render(<CoverPlaceholder label="无封面" />)

    expect(screen.getByText('无封面')).toBeInTheDocument()
    expect(container.querySelectorAll('span')).toHaveLength(1)
  })

  it('passes className, bgClassName, and labelClassName through', () => {
    const { container } = render(
      <CoverPlaceholder
        icon={<span>♪</span>}
        label="无封面"
        className="extra-container"
        bgClassName="bg-[var(--home-bg-surface)]"
        iconClassName="extra-icon"
        labelClassName="extra-label"
      />
    )

    expect(container.firstChild).toHaveClass('extra-container')
    expect(container.firstChild).toHaveClass('bg-[var(--home-bg-surface)]')
    expect(container.firstChild).not.toHaveClass('bg-surface-alt')
    expect(container.querySelector('.extra-icon')).toBeInTheDocument()
    expect(container.querySelector('.extra-label')).toBeInTheDocument()
  })
})
