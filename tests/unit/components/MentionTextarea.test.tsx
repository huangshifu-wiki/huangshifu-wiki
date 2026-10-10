// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MentionTextarea from '../../../src/components/MentionTextarea'

const mockApiGet = vi.hoisted(() => vi.fn())

vi.mock('../../../src/lib/apiClient', () => ({
  apiGet: mockApiGet,
}))

function renderMentionTextarea(props: Partial<ComponentProps<typeof MentionTextarea>> = {}) {
  return render(
    <MemoryRouter>
      <div className="relative">
        <MentionTextarea value="@Ali" onChange={vi.fn()} {...props} />
      </div>
    </MemoryRouter>
  )
}

async function openSuggestions(textarea: HTMLTextAreaElement) {
  textarea.setSelectionRange(4, 4)
  fireEvent.click(textarea)

  await screen.findByRole('listbox')
}

describe('MentionTextarea', () => {
  beforeEach(() => {
    mockApiGet.mockResolvedValue({
      users: [{ uid: 'user-alice', displayName: 'Alice', photoURL: null }],
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('dismisses suggestions with Escape', async () => {
    renderMentionTextarea()
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    await openSuggestions(textarea)
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('dismisses suggestions with outside clicks', async () => {
    const user = userEvent.setup()
    renderMentionTextarea()
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    await openSuggestions(textarea)
    await user.click(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does not select a suggestion while IME composition is active', async () => {
    const onChange = vi.fn()
    renderMentionTextarea({ onChange })
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    await openSuggestions(textarea)
    fireEvent.compositionStart(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })
})
