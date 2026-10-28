import { describe, expect, it } from 'vitest'
import { ticketListingWriteSchema } from '../../src/server/schemas/ticket-listing.schema'

const validLinked = {
  type: 'offer' as const,
  eventId: 'event-1',
  quantity: 1,
  ticketTier: '看台',
  seat: 'A区',
  description: '',
  contact: ' 联系方式 ',
}

const validCustom = {
  type: 'request' as const,
  customEventName: ' 自定义活动 ',
  quantity: 10000,
  ticketTier: '内场',
  seat: '',
  description: '',
  contact: '微信号',
}

describe('ticketListingWriteSchema', () => {
  it('接受出票和收票的关联活动、自定义活动输入，并 trim 字符串', () => {
    const linked = ticketListingWriteSchema.parse(validLinked)
    const custom = ticketListingWriteSchema.parse(validCustom)

    expect(linked).toMatchObject({ eventId: 'event-1', contact: '联系方式', seat: 'A区' })
    expect(custom).toMatchObject({ customEventName: '自定义活动', contact: '微信号' })
  })

  it('严格要求关联活动和自定义活动二选一', () => {
    expect(
      ticketListingWriteSchema.safeParse({ ...validLinked, customEventName: '另一个活动' }).success
    ).toBe(false)
    expect(ticketListingWriteSchema.safeParse({ ...validLinked, eventId: undefined }).success).toBe(
      false
    )
    expect(ticketListingWriteSchema.safeParse({ ...validCustom, eventId: 'event-1' }).success).toBe(
      false
    )
  })

  it('验证数量边界、必填字段和无效类型', () => {
    expect(ticketListingWriteSchema.safeParse({ ...validLinked, quantity: 0 }).success).toBe(false)
    expect(ticketListingWriteSchema.safeParse({ ...validLinked, quantity: 10001 }).success).toBe(
      false
    )
    expect(ticketListingWriteSchema.safeParse({ ...validLinked, quantity: 1.5 }).success).toBe(
      false
    )
    expect(ticketListingWriteSchema.safeParse({ ...validLinked, ticketTier: ' ' }).success).toBe(
      false
    )
    expect(ticketListingWriteSchema.safeParse({ ...validLinked, contact: ' ' }).success).toBe(false)
    expect(ticketListingWriteSchema.safeParse({ ...validLinked, type: 'trade' }).success).toBe(
      false
    )
  })

  it('拒绝未知字段并执行长度上限', () => {
    expect(ticketListingWriteSchema.safeParse({ ...validLinked, unexpected: true }).success).toBe(
      false
    )
    expect(
      ticketListingWriteSchema.safeParse({
        ...validCustom,
        customEventName: 'x'.repeat(201),
      }).success
    ).toBe(false)
    expect(
      ticketListingWriteSchema.safeParse({
        ...validLinked,
        ticketTier: 'x'.repeat(101),
      }).success
    ).toBe(false)
  })
})
