import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Calendar, ChevronRight } from '@/src/components/icons'
import { motion } from 'motion/react'
import { apiGet } from '../../lib/apiClient'
import type { WikiItem } from './types'

const WikiTimeline = () => {
  const [events, setEvents] = useState<WikiItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const data = await apiGet<{ events: WikiItem[] }>('/api/wiki/timeline')
        setEvents((data.events || []).filter((p) => p.eventDate))
      } catch (e) {
        console.error('Error fetching timeline events:', e)
      }
      setLoading(false)
    }
    fetchEvents()
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <Link
        to={'/wiki'}
        className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-brand-gold transition-colors mb-5"
      >
        <ArrowLeft size={18} /> 返回百科列表
      </Link>

      <header className="mb-16 text-center">
        <h1 className="text-[1.75rem] font-bold text-text-primary tracking-[0.12em] mb-3">
          艺术历程时间轴
        </h1>
        <p className="text-text-muted italic tracking-[0.08em]">
          记录黄诗扶音乐生涯的每一个重要节点
        </p>
      </header>

      {loading ? (
        <div className="space-y-12">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-8 animate-pulse">
              <div className="w-32 h-8 bg-surface-alt rounded"></div>
              <div className="flex-grow h-32 bg-bg-secondary rounded"></div>
            </div>
          ))}
        </div>
      ) : events.length > 0 ? (
        <div className="relative border-l-2 border-brand-gold/20 ml-4 md:ml-32 pl-8 md:pl-12 space-y-16 pb-20">
          {events.map((event, idx) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="relative"
            >
              {/* Date Indicator */}
              <div className="absolute -left-[41px] md:-left-[141px] top-0 flex items-center gap-4">
                <div className="hidden md:block w-24 text-right">
                  <span className="text-sm font-bold text-brand-gold bg-surface-alt px-3 py-1 rounded whitespace-nowrap">
                    {event.eventDate}
                  </span>
                </div>
                <div className="w-4 h-4 rounded bg-brand-gold border-4 border-surface z-10"></div>
              </div>

              {/* Content Card */}
              <Link to={`/wiki/${event.slug}`} className="block group">
                <div className="bg-surface p-8 rounded border border-border hover:border-brand-gold transition-all">
                  <div className="md:hidden mb-4">
                    <span className="text-xs font-bold text-brand-gold bg-surface-alt px-2 py-1 rounded">
                      {event.eventDate}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-1 bg-surface-alt text-brand-gold text-[10px] font-bold uppercase tracking-wider rounded">
                      {event.category === 'biography'
                        ? '人物介绍'
                        : event.category === 'music'
                          ? '音乐作品'
                          : event.category === 'album'
                            ? '专辑一览'
                            : event.category === 'timeline'
                              ? '时间轴'
                              : event.category === 'event'
                                ? '活动记录'
                                : event.category}
                    </span>
                  </div>
                  <h3 className="text-2xl font-serif font-bold text-text-primary group-hover:text-brand-gold transition-colors mb-4">
                    {event.title}
                  </h3>
                  <div className="mt-6 flex items-center gap-2 text-brand-gold text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                    查看详情 <ChevronRight size={14} />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-surface rounded border border-border">
          <Calendar size={48} className="mx-auto text-border-light mb-6" />
          <p className="text-text-muted italic">暂无时间轴数据，请在编辑页面设置"事件日期"</p>
        </div>
      )}
    </div>
  )
}

export default WikiTimeline
