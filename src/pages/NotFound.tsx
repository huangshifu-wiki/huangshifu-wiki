import { Link, useLocation } from 'react-router-dom'

type NotFoundProps = {
  homePath?: string
  homeLabel?: string
}

const NotFound = ({ homePath = '/', homeLabel = '返回首页' }: NotFoundProps) => {
  const location = useLocation()

  return (
    <section className="mx-auto flex min-h-[52vh] max-w-[760px] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-5 inline-flex rounded-full border border-brand-gold/35 bg-surface px-4 py-1 text-xs font-semibold tracking-[0.28em] text-brand-gold">
        404
      </div>
      <h1 className="text-3xl font-bold tracking-[0.16em] text-text-primary sm:text-4xl">
        页面不存在
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-7 tracking-[0.06em] text-text-secondary sm:text-base">
        当前路径没有对应页面，请检查链接是否正确，或回到已有栏目继续浏览。
      </p>
      <p className="mt-3 max-w-full break-all rounded border border-border bg-surface-alt px-4 py-2 text-xs text-text-muted">
        {location.pathname}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          to={homePath}
          className="rounded bg-brand-gold px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-gold/90"
        >
          {homeLabel}
        </Link>
        <Link
          to="/search"
          className="rounded border border-border px-5 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:border-brand-gold hover:text-brand-gold"
        >
          去搜索
        </Link>
      </div>
    </section>
  )
}

export default NotFound
