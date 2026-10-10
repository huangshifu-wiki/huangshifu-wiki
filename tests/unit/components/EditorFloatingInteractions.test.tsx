// @vitest-environment jsdom
import { useState } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormModal } from '../../../src/components/Modal/FormModal'
import { LocationTagInput } from '../../../src/components/LocationTagInput'
import MentionTextarea from '../../../src/components/MentionTextarea'
import { MatchSuggestionModal } from '../../../src/components/MatchSuggestionModal'
import { MapPickerModal } from '../../../src/components/MapPickerModal'
import { Button, Input } from '../../../src/components/ui'

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('../../../src/lib/apiClient', () => ({ apiGet, apiPost }))
const { loadAmapJsApi } = vi.hoisted(() => ({ loadAmapJsApi: vi.fn() }))
vi.mock('../../../src/lib/amapLoader', () => ({ loadAmapJsApi }))

const region = {
  code: '310000',
  name: '上海',
  fullName: '上海市',
  level: 1,
  levelName: '省级',
  parentCode: null,
}

function CandidateEditor({ mention = false }: { mention?: boolean }) {
  const [location, setLocation] = useState('')
  const [code, setCode] = useState('')
  const [text, setText] = useState('')
  return (
    <FormModal open onClose={() => {}} title="编辑候选">
      <Input aria-label="草稿" defaultValue="保留的草稿" />
      {mention ? (
        <MentionTextarea value={text} onChange={setText} />
      ) : (
        <LocationTagInput
          value={location}
          locationCode={code}
          onChange={(name, nextCode) => {
            setLocation(name)
            setCode(nextCode)
          }}
          onClear={() => {
            setLocation('')
            setCode('')
          }}
        />
      )}
      <output aria-label="已选地点">
        {location}:{code}
      </output>
      <Button>下一项</Button>
    </FormModal>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('编辑弹窗内的候选', () => {
  it('点选地点写入名称和行政编码，Tab 离开后不残留候选', async () => {
    apiGet.mockResolvedValue({ regions: [region] })
    const user = userEvent.setup()
    render(<CandidateEditor />)
    const input = screen.getByPlaceholderText('输入或选择地点...')
    await user.type(input, '上海')
    await screen.findByRole('listbox', { name: '地点候选' })
    await user.tab()
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '下一项' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.click(input)
    await user.click(await screen.findByRole('option', { name: /上海/ }))
    expect(screen.getByLabelText('已选地点')).toHaveTextContent('上海市:310000')
    expect(input).toHaveValue('上海市')
    expect(screen.getByLabelText('草稿')).toHaveValue('保留的草稿')
  })

  it.each(['empty', 'error'])('地点查询 %s 后不能选择上一轮候选', async (result) => {
    apiGet.mockResolvedValueOnce({ regions: [region] })
    if (result === 'empty') apiGet.mockResolvedValueOnce({ regions: [] })
    else apiGet.mockRejectedValueOnce(new Error('查询失败'))
    const user = userEvent.setup()
    render(<CandidateEditor />)
    const input = screen.getByPlaceholderText('输入或选择地点...')
    await user.type(input, '上海')
    await screen.findByRole('option', { name: /上海/ })
    await user.clear(input)
    await user.type(input, '北京')
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument())
    expect(screen.getByLabelText('已选地点')).toHaveTextContent(':')
  })

  it('提及选择替换当前 token 并恢复光标，Escape 不关闭编辑弹窗', async () => {
    apiGet.mockResolvedValue({ users: [{ uid: 'u1', publicId: '42', displayName: '诗扶' }] })
    const user = userEvent.setup()
    render(<CandidateEditor mention />)
    const input = screen.getByRole('textbox', { name: '' })
    await user.type(input, '你好 @诗')
    await user.click(await screen.findByRole('option', { name: /诗扶/ }))
    await waitFor(() => expect(input).toHaveFocus())
    expect(input).toHaveValue('你好 @诗扶 ')
    expect((input as HTMLTextAreaElement).selectionStart).toBe('你好 @诗扶 '.length)
    await user.type(input, '@诗')
    await screen.findByRole('listbox', { name: '提及候选' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '编辑候选' })).toBeInTheDocument()
    expect(screen.getByLabelText('草稿')).toHaveValue('保留的草稿')
  })

  it.each(['empty', 'error'])('提及查询 %s 后不插入旧用户，Tab 可继续编辑', async (result) => {
    apiGet.mockResolvedValueOnce({ users: [{ uid: 'u1', publicId: '42', displayName: '诗扶' }] })
    if (result === 'empty') apiGet.mockResolvedValueOnce({ users: [] })
    else apiGet.mockRejectedValueOnce(new Error('查询失败'))
    const user = userEvent.setup()
    render(<CandidateEditor mention />)
    const input = screen.getByRole('textbox', { name: '' })
    await user.type(input, '@诗')
    await screen.findByRole('option', { name: /诗扶/ })
    await user.clear(input)
    await user.type(input, '@另一位')
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument())
    await user.keyboard('{Enter}')
    expect(input).toHaveValue('@另一位\n')
    await user.tab()
    expect(screen.getByRole('button', { name: '下一项' })).toHaveFocus()
    expect(screen.getByLabelText('草稿')).toHaveValue('保留的草稿')
  })
})

function ChildEditor({ map = false }: { map?: boolean }) {
  const [childOpen, setChildOpen] = useState(false)
  const [sourceId, setSourceId] = useState('原来的ID')
  return (
    <>
      <FormModal open onClose={() => {}} title="歌曲草稿">
        <Input aria-label="歌曲标题" defaultValue="未保存的标题" />
        <Button onClick={() => setChildOpen(true)}>打开子弹窗</Button>
        <output aria-label="平台ID">{sourceId}</output>
      </FormModal>
      {map ? (
        <MapPickerModal open={childOpen} onClose={() => setChildOpen(false)} onConfirm={() => {}} />
      ) : (
        <MatchSuggestionModal
          open={childOpen}
          onClose={() => setChildOpen(false)}
          title="曲目"
          artist="黄诗扶"
          targetPlatform="netease"
          onSelect={setSourceId}
        />
      )}
    </>
  )
}

const suggestion = {
  sourceId: 'new-source',
  title: '候选歌曲',
  artists: ['黄诗扶'],
  album: '专辑',
  cover: '',
  score: 95,
  isAutoSelected: true,
  alreadyLinked: null,
}

describe('编辑器子弹窗', () => {
  it('匹配确认更新平台 ID，取消不改变原 ID，外层草稿始终保留', async () => {
    apiGet.mockResolvedValue({ suggestions: [suggestion] })
    const user = userEvent.setup()
    render(<ChildEditor />)
    await user.click(screen.getByRole('button', { name: '打开子弹窗' }))
    const child = await screen.findByRole('dialog', { name: '搜索匹配歌曲' })
    await within(child).findByRole('button', { name: /候选歌曲/ })
    await user.click(within(child).getByRole('button', { name: '取消' }))
    expect(screen.getByLabelText('平台ID')).toHaveTextContent('原来的ID')
    expect(screen.getByLabelText('歌曲标题')).toHaveValue('未保存的标题')
    await user.click(screen.getByRole('button', { name: '打开子弹窗' }))
    const reopened = await screen.findByRole('dialog', { name: '搜索匹配歌曲' })
    await within(reopened).findByRole('button', { name: /候选歌曲/ })
    await user.click(within(reopened).getByRole('button', { name: '确认' }))
    expect(screen.getByLabelText('平台ID')).toHaveTextContent('new-source')
    expect(screen.getByLabelText('歌曲标题')).toHaveValue('未保存的标题')
    expect(screen.queryByRole('dialog', { name: '搜索匹配歌曲' })).not.toBeInTheDocument()
  })

  it('地图搜索框保持焦点，Escape 只关闭地图，重开使用新实例', async () => {
    const destroy = vi.fn()
    const Map = vi.fn(function () {
      return { on: vi.fn(), destroy }
    })
    loadAmapJsApi.mockResolvedValue({ Map })
    const user = userEvent.setup()
    render(<ChildEditor map />)
    const trigger = screen.getByRole('button', { name: '打开子弹窗' })
    await user.click(trigger)
    const search = await screen.findByPlaceholderText('搜索地址...')
    await user.type(search, '上海')
    expect(search).toHaveFocus()
    expect(search).toHaveValue('上海')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '选择地点' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('歌曲标题')).toHaveValue('未保存的标题')
    await waitFor(() => expect(destroy).toHaveBeenCalledTimes(1))
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await waitFor(() => expect(Map).toHaveBeenCalledTimes(2))
    expect(screen.getByPlaceholderText('搜索地址...')).toBeInTheDocument()
  })

  it('地图 SDK 延迟返回时已关闭，不向卸载的容器创建实例', async () => {
    const Map = vi.fn()
    // 项目类型库为 ES2022，尚未声明 Promise.withResolvers。
    let resolveSdk!: (sdk: { Map: typeof Map }) => void
    const promise = new Promise<{ Map: typeof Map }>((resolve) => {
      resolveSdk = resolve
    })
    loadAmapJsApi.mockReturnValue(promise)
    const user = userEvent.setup()
    render(<ChildEditor map />)
    await user.click(screen.getByRole('button', { name: '打开子弹窗' }))
    await screen.findByPlaceholderText('搜索地址...')
    await user.keyboard('{Escape}')
    await act(async () => {
      resolveSdk({ Map })
    })
    expect(Map).not.toHaveBeenCalled()
    expect(screen.getByLabelText('歌曲标题')).toHaveValue('未保存的标题')
  })
})
