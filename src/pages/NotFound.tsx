import { Link, useLocation } from 'react-router-dom'

type NotFoundProps = {
  homePath?: string
  homeLabel?: string
}

const NotFound = ({ homePath = '/', homeLabel = '返回首页' }: NotFoundProps) => {
  const location = useLocation()

  return (
    <section className="mobile-page-shell flex min-h-[calc(100vh-60px)] items-center justify-center px-6 py-16 text-center">
      <div className="relative z-10 mx-auto max-w-[760px]">
        <p className="mb-4 text-xs font-medium tracking-[0.28em] text-brand-gold">404</p>
        <h1 className="font-[var(--book-title-font)] text-4xl font-normal tracking-[0.16em] text-text-primary sm:text-5xl">
          页面不存在
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-7 tracking-[0.06em] text-text-secondary sm:text-base">
          当前路径没有对应页面，请检查链接是否正确，或回到已有栏目继续浏览。
        </p>
        <p className="mt-3 max-w-full break-all border-y border-[var(--book-ink-line)] px-4 py-2 text-xs text-text-muted">
          {location.pathname}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to={homePath}
            data-pressable
            className="inline-flex items-center rounded bg-brand-gold px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-gold/90"
          >
            {homeLabel}
          </Link>
          <Link
            to="/search"
            data-pressable
            className="inline-flex items-center rounded border border-border px-5 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:border-brand-gold hover:text-brand-gold"
          >
            去搜索
          </Link>
        </div>
      </div>
    </section>
  )
}

export default NotFound
