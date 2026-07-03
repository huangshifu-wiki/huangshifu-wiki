import { useState, useEffect } from 'react'
import { ChevronUp } from '@/src/components/icons'

export default function BackToTop() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const toggleVisibility = () => {
      setIsVisible(window.scrollY > 300)
    }

    window.addEventListener('scroll', toggleVisibility, { passive: true })
    return () => window.removeEventListener('scroll', toggleVisibility)
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!isVisible) return null

  return (
    <button
      onClick={scrollToTop}
      aria-label="返回顶部"
      className="
				fixed right-6 bottom-24 z-[140]
				w-12 h-12
				bg-brand-gold text-white rounded-full
				shadow-lg hover:bg-brand-gold-light
				transition-all duration-300
				cursor-pointer flex items-center justify-center touch-target-lg
				back-to-top-button
			"
    >
      <ChevronUp size={20} />
    </button>
  )
}
