import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Book,
  MessageSquare,
  Music,
  Image,
  Calendar,
  ArrowRight,
  Disc3,
  Library,
  Clock,
  MapPin,
} from 'lucide-react';
import { apiGet } from '../../lib/apiClient';
import type { HomeFeedResponse } from '../../types/home';

export const DefaultHome = () => {
  const [, setFeed] = useState<HomeFeedResponse | null>(null);

  useEffect(() => {
    const fetchFeed = async () => {
      try {
        const data = await apiGet<HomeFeedResponse>('/api/home/feed');
        setFeed(data);
      } catch (e) {
        console.error('Error fetching home feed:', e);
      }
    };
    fetchFeed();
  }, []);

  const navCards = [
    { title: '百科', icon: <Book size={18} />, link: '/wiki' },
    { title: '论坛', icon: <MessageSquare size={18} />, link: '/forum' },
    { title: '图集', icon: <Image size={18} />, link: '/gallery' },
    { title: '音乐', icon: <Music size={18} />, link: '/music' },
    { title: '活动', icon: <Calendar size={18} />, link: '/wiki?category=event' },
  ];

  const quickLinks = [
    { title: '时间轴', link: '/wiki/timeline', icon: <Clock size={16} /> },
    { title: '年表', link: '/wiki?category=timeline', icon: <Calendar size={16} /> },
    { title: '地图', link: '/wiki', icon: <MapPin size={16} /> },
  ];

  return (
    <div
      className="min-h-[calc(100vh-60px)]"
      style={{
        backgroundColor: '#f7f5f0',
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <style>{`
        .home-page ::selection {
          background-color: #fdf5d8;
          color: #c8951e;
        }
      `}</style>

      <div className="max-w-[1100px] mx-auto px-6 py-12 pb-32 home-page">
        {/* Hero */}
        <header className="mb-16 text-center">
          <h1
            className="text-[3.5rem] sm:text-[5rem] font-bold tracking-[0.15em] text-[#2c2c2c] mb-4"
            style={{ fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}
          >
            黄诗扶
          </h1>
          <p className="text-[#9e968e] text-lg sm:text-xl italic tracking-[0.1em] mb-10">
            人生难得一知音
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to='/wiki'
              className="px-6 py-2.5 bg-[#c8951e] text-white text-[0.9375rem] rounded hover:bg-[#dca828] transition-all flex items-center gap-2"
            >
              <Library size={16} /> 进入百科
            </Link>
            <Link
              to='/music'
              className="px-6 py-2.5 border border-[#e0dcd3] text-[#6b6560] text-[0.9375rem] rounded hover:text-[#c8951e] hover:border-[#c8951e] transition-all flex items-center gap-2"
            >
              <Music size={16} /> 曲库
            </Link>
          </div>
        </header>

        {/* Nav Cards */}
        <section className="mb-12">
          <div className="flex items-end justify-between border-b border-[#e0dcd3] mb-6">
            <h2 className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]">
              内容
            </h2>
            <Link
              to='/wiki'
              className="text-[0.8125rem] text-[#c8951e] font-medium hover:text-[#dca828] transition-colors flex items-center gap-1 pb-2"
            >
              查看全部 <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {navCards.map((card) => (
              <Link
                key={card.title}
                to={card.link}
                className="px-3 py-2.5 bg-white border border-[#e0dcd3] rounded hover:border-[#c8951e] transition-all group"
              >
                <div className="flex items-center gap-2 text-[#c8951e]">
                  {card.icon}
                  <span className="font-medium text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors">
                    {card.title}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Intro + Quick Links */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 mb-12">
          <section>
            <div className="flex items-end justify-between border-b border-[#e0dcd3] mb-5">
              <h2 className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]">
                关于
              </h2>
            </div>
            <div className="p-5 bg-white border border-[#e0dcd3] rounded">
              <p className="text-[#6b6560] leading-[1.9] text-[0.9375rem] mb-4">
                黄诗扶，古风音乐人、歌手。毕业于英国布里斯托大学，代表作有《吹梦到西洲》《人间不值得》《九万字》等。
                本百科旨在系统整理与黄诗扶相关的音乐作品、人物资料、活动记录与时间线，方便知音查阅。
              </p>
              <p className="text-[#6b6560] leading-[1.9] text-[0.9375rem]">
                百科内容开放编辑，欢迎补充资料、修正错误。所有修改均经过审核后发布，以确保信息的准确性。
              </p>
            </div>
          </section>

          <aside>
            <div className="flex items-end justify-between border-b border-[#e0dcd3] mb-5">
              <h2 className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]">
                快速导航
              </h2>
            </div>
            <div className="flex flex-col gap-2">
              {quickLinks.map((item) => (
                <Link
                  key={item.title}
                  to={item.link}
                  className="flex items-center gap-3 p-3 bg-white border border-[#e0dcd3] rounded hover:border-[#c8951e] transition-all group"
                >
                  <span className="text-[#c8951e]">{item.icon}</span>
                  <p className="text-sm font-medium text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors">
                    {item.title}
                  </p>
                </Link>
              ))}
            </div>
          </aside>
        </div>

        {/* Stats */}
        <section className="border-t border-[#e0dcd3] pt-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1 text-[#c8951e]">
                <Music size={18} />
                <span className="text-2xl font-semibold text-[#2c2c2c]">1,240+</span>
              </div>
              <p className="text-xs text-[#9e968e] tracking-wider">收录曲目</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1 text-[#c8951e]">
                <Book size={18} />
                <span className="text-2xl font-semibold text-[#2c2c2c]">200+</span>
              </div>
              <p className="text-xs text-[#9e968e] tracking-wider">百科词条</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1 text-[#c8951e]">
                <Disc3 size={18} />
                <span className="text-2xl font-semibold text-[#2c2c2c]">30+</span>
              </div>
              <p className="text-xs text-[#9e968e] tracking-wider">专辑与 EP</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1 text-[#c8951e]">
                <Calendar size={18} />
                <span className="text-2xl font-semibold text-[#2c2c2c]">100+</span>
              </div>
              <p className="text-xs text-[#9e968e] tracking-wider">活动记录</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default DefaultHome;
