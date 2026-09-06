// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EventDateOffset } from '../../src/components/Events/EventDateOffset'

describe('EventDateOffset', () => {
  it('未来活动显示 +N 天数徽标', () => {
    render(<EventDateOffset dayOffset={3} />)
    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('今天（+0）同样显示徽标', () => {
    render(<EventDateOffset dayOffset={0} />)
    expect(screen.getByText('+0')).toBeInTheDocument()
  })

  it('过去或无时间的活动不渲染徽标', () => {
    const { container } = render(
      <>
        <EventDateOffset dayOffset={-2} />
        <EventDateOffset dayOffset={null} />
      </>
    )
    expect(container).toBeEmptyDOMElement()
  })
})
