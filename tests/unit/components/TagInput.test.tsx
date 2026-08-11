// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Field, TagInput } from '../../../src/components/ui'

function ControlledTagInput({
  initialTags = ['古风'],
  suggestions = ['古风', '现场', '原创'],
}: {
  initialTags?: string[]
  suggestions?: string[]
}) {
  const [tags, setTags] = useState(initialTags)
  return <TagInput value={tags} onChange={setTags} suggestions={suggestions} />
}

describe('TagInput', () => {
  it('uses Field context to associate its input with the label', () => {
    render(
      <Field label="标签">
        <TagInput value={[]} onChange={() => {}} suggestions={[]} />
      </Field>
    )

    expect(screen.getByLabelText('标签')).toBe(screen.getByRole('combobox'))
  })
  it('renders controlled tags and removes only the selected token', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput initialTags={['古风', '现场']} />)
    expect(screen.getByText('古风')).toBeInTheDocument()
    expect(screen.getByText('现场')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /删除标签：/ })).toHaveLength(2)
    const input = screen.getByRole('combobox')

    await user.click(screen.getByRole('button', { name: '删除标签：古风' }))

    expect(screen.queryByRole('button', { name: '删除标签：古风' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '古风' })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBe(input)
    const secondRemoveButton = screen.getByRole('button', { name: '删除标签：现场' })
    fireEvent.pointerDown(secondRemoveButton, { button: 0 })
    fireEvent.blur(input, { relatedTarget: null })
    fireEvent.pointerUp(secondRemoveButton, { button: 0 })
    fireEvent.click(secondRemoveButton)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(screen.getByRole('listbox')).toBeVisible()
    expect(screen.getByRole('combobox')).toHaveFocus()
    expect(screen.getByRole('combobox')).toBe(input)
  })

  it('adds a trimmed tag with Enter and clears the transient input', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput suggestions={[]} />)
    const input = screen.getByRole('combobox')

    await user.type(input, ' 原创 ')
    await user.keyboard('{Enter}')

    expect(screen.getByText('原创')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('ignores blank and duplicate tags', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput suggestions={[]} />)
    const input = screen.getByRole('combobox')

    await user.keyboard('{Enter}')
    await user.type(input, '古风')
    await user.keyboard('{Enter}')

    expect(screen.getAllByText('古风')).toHaveLength(1)
  })

  it('opens suggestions on input focus and adds an unselected option by click', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput />)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox'))
    expect(screen.queryByRole('button', { name: /标签列表/ })).not.toBeInTheDocument()

    expect(screen.getByRole('listbox')).toBeVisible()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(
      screen.getByRole('listbox').closest('[data-radix-popper-content-wrapper]')
    ).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '古风' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: '现场' }))
    expect(screen.getByText('现场')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
  })
  it('dismisses suggestions when disabled and does not reopen when re-enabled', async () => {
    const user = userEvent.setup()
    const props = {
      value: [],
      onChange: () => {},
      suggestions: ['现场'],
    }
    const { rerender } = render(<TagInput {...props} />)

    await user.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toBeVisible()

    rerender(<TagInput {...props} disabled />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    rerender(<TagInput {...props} />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
  it('opens suggestions when clicking an existing tag', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput initialTags={['古风']} />)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.click(screen.getByText('古风'))

    expect(screen.getByRole('listbox')).toBeVisible()
    expect(screen.getByRole('combobox')).toHaveFocus()
  })
  it('keeps suggestions open when clicking a tag while already open', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput initialTags={['古风']} />)
    const input = screen.getByRole('combobox')

    await user.click(input)
    await user.click(screen.getByText('古风'))

    expect(screen.getByRole('listbox')).toBeVisible()
    expect(input).toHaveFocus()
  })

  it('updates suggestions when focus moves to and away from the input with Tab', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">前一个</button>
        <ControlledTagInput initialTags={[]} />
        <button type="button">后一个</button>
      </>
    )
    const previous = screen.getByRole('button', { name: '前一个' })
    const input = screen.getByRole('combobox')
    const next = screen.getByRole('button', { name: '后一个' })

    await user.click(previous)
    await user.tab()

    expect(input).toHaveFocus()
    expect(screen.getByRole('listbox')).toBeVisible()

    fireEvent.blur(input, { relatedTarget: next })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports arrow navigation and highlighted Enter selection', async () => {
    const user = userEvent.setup()
    render(<ControlledTagInput suggestions={['现场', '原创']} />)
    const input = screen.getByRole('combobox')

    await user.click(input)
    const firstOption = screen.getByRole('option', { name: '现场' })
    expect(input).toHaveAttribute('aria-haspopup', 'listbox')

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', firstOption.id)
    expect(firstOption).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')
    expect(screen.getByText('现场')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('closes suggestions with Escape and outside pointerdown', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ControlledTagInput />
        <button type="button">外部区域</button>
      </>
    )
    const input = screen.getByRole('combobox')
    const outside = screen.getByRole('button', { name: '外部区域' })

    await user.click(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(input)
    fireEvent.pointerDown(outside, { button: 0 })
    fireEvent.click(outside)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does not add a tag during IME composition', () => {
    render(<ControlledTagInput suggestions={[]} />)
    const input = screen.getByRole('combobox')

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '新' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(screen.queryByText('新')).not.toBeInTheDocument()

    fireEvent.compositionEnd(input)
  })

  it('reflects parent-controlled value changes', () => {
    const { rerender } = render(
      <TagInput value={['古风']} onChange={() => {}} suggestions={['古风', '现场']} />
    )

    rerender(<TagInput value={['现场']} onChange={() => {}} suggestions={['古风', '现场']} />)

    expect(screen.queryByText('古风')).not.toBeInTheDocument()
    expect(screen.getByText('现场')).toBeInTheDocument()
  })
})
