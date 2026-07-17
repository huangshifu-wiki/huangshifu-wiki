import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToastProvider,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from '@/src/components/ui'

afterEach(() => {
  vi.useRealTimers()
})

describe('UI 设计系统', () => {
  it('Button 在加载时禁用并暴露 busy 状态', () => {
    render(
      <Button loading loadingText="保存中">
        保存
      </Button>
    )
    const button = screen.getByRole('button', { name: '保存中' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('Field 自动关联 label、说明和错误', () => {
    render(
      <Field label="标题" description="公开显示" error="标题不能为空" required>
        <Input />
      </Field>
    )
    const input = screen.getByRole('textbox', { name: /标题/ })
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(describedBy.split(' ')).toHaveLength(2)
    expect(screen.getByRole('alert')).toHaveTextContent('标题不能为空')
  })

  it('Switch 支持键盘切换', async () => {
    const user = userEvent.setup()
    render(<Switch label="公开" />)
    const control = screen.getByRole('switch', { name: '公开' })
    control.focus()
    await user.keyboard(' ')
    expect(control).toHaveAttribute('aria-checked', 'true')
  })

  it('Switch 传递新状态并保留选中样式', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    const { rerender } = render(
      <Switch label="公开" checked={false} onCheckedChange={onCheckedChange} />
    )
    const control = screen.getByRole('switch', { name: '公开' })

    await user.click(screen.getByText('公开'))
    expect(onCheckedChange).toHaveBeenLastCalledWith(true)

    rerender(<Switch label="公开" checked onCheckedChange={onCheckedChange} />)
    expect(control).toHaveAttribute('data-state', 'checked')
    expect(control).toHaveAttribute('aria-checked', 'true')
    expect(control).not.toHaveClass('bg-surface-alt')
    expect(control.className).toContain('data-[state=checked]:bg-')

    rerender(<Switch label="公开" checked disabled onCheckedChange={onCheckedChange} />)
    await user.click(screen.getByText('公开'))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
  })

  it('Checkbox 支持受控状态、标签点击和禁用态', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    const { rerender } = render(
      <Checkbox label="允许评论" checked={false} onCheckedChange={onCheckedChange} />
    )
    const control = screen.getByRole('checkbox', { name: '允许评论' })

    await user.click(screen.getByText('允许评论'))
    expect(onCheckedChange).toHaveBeenLastCalledWith(true)

    rerender(<Checkbox label="允许评论" checked onCheckedChange={onCheckedChange} />)
    expect(control).toHaveAttribute('data-state', 'checked')
    expect(control).toHaveAttribute('aria-checked', 'true')

    rerender(<Checkbox label="允许评论" checked disabled onCheckedChange={onCheckedChange} />)
    await user.click(screen.getByText('允许评论'))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
  })

  it('Dialog 限制焦点并在关闭后恢复触发点', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>打开编辑</Button>
        </DialogTrigger>
        <DialogContent title="编辑条目">
          <div className="p-4">
            <Input aria-label="标题" />
            <Button>保存</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
    const trigger = screen.getByRole('button', { name: '打开编辑' })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('DropdownMenu 与 Tabs 支持方向键导航', async () => {
    const user = userEvent.setup()
    render(
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>操作</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>编辑</DropdownMenuItem>
            <DropdownMenuItem>删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">资料</TabsTrigger>
            <TabsTrigger value="b">修订</TabsTrigger>
          </TabsList>
          <TabsContent value="a">资料页</TabsContent>
          <TabsContent value="b">修订页</TabsContent>
        </Tabs>
      </>
    )
    await user.click(screen.getByRole('button', { name: '操作' }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: '编辑' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: '删除' })).toHaveFocus()
    await user.keyboard('{Escape}')

    const firstTab = screen.getByRole('tab', { name: '资料' })
    firstTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '修订' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Popover 与 Tooltip 可通过标准交互打开', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider delayDuration={0}>
        <Popover>
          <PopoverTrigger asChild>
            <Button>说明</Button>
          </PopoverTrigger>
          <PopoverContent>浮层内容</PopoverContent>
        </Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button>提示</Button>
          </TooltipTrigger>
          <TooltipContent>提示内容</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
    await user.click(screen.getByRole('button', { name: '说明' }))
    expect(screen.getByText('浮层内容')).toBeVisible()
    await user.hover(screen.getByRole('button', { name: '提示' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('提示内容')
  })

  it('Toast 到期后自动移除', () => {
    vi.useFakeTimers()
    const Trigger = () => {
      const { show } = useToast()
      return <Button onClick={() => show('保存成功', { duration: 1200 })}>显示通知</Button>
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: '显示通知' }))
    expect(screen.getByText('保存成功')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1300))
    expect(screen.queryByRole('button', { name: '关闭通知' })).not.toBeInTheDocument()
  })

  it('Table 保留原生表格语义', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标题</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>山鬼</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '标题' })).toHaveAttribute('scope', 'col')
    expect(screen.getByRole('cell', { name: '山鬼' })).toBeInTheDocument()
  })
})
