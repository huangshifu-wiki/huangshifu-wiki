import React from 'react';
import { NavLink } from 'react-router-dom';
import { Music, Book, MessageSquare, Image as ImageIcon, Search, Home } from 'lucide-react';
import { clsx } from 'clsx';

export const BottomNav = () => {

  const items = [
    { to: '/', icon: Home, label: '首页' },
    { to: '/wiki', icon: Book, label: '百科' },
    { to: '/forum', icon: MessageSquare, label: '社区' },
    { to: '/gallery', icon: ImageIcon, label: '图集' },
    { to: '/music', icon: Music, label: '音乐' },
    { to: '/search', icon: Search, label: '搜索' },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-[150] border-t border-[#e0dcd3]"
      style={{ background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(16px)' }}
    >
      <div className="flex justify-around items-center" style={{ height: '56px' }}>
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => clsx(
              'flex flex-col items-center gap-0.5 transition-all',
              isActive ? 'text-[#c8951e]' : 'text-[#9e968e]'
            )}
          >
            <Icon size={22} />
            <span style={{ fontSize: '0.625rem' }}>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
};
