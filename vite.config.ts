import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig, type PluginOption } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig(({ mode }) => {
  const isAnalyze = process.env.ANALYZE === 'true'

  return {
    plugins: [
      react(),
      tailwindcss(),
      isAnalyze &&
        (visualizer({
          open: true,
          gzipSize: true,
          brotliSize: true,
          filename: 'dist/stats.html',
        }) as PluginOption),
    ].filter(Boolean),
    build: {
      target: 'es2020',
      cssCodeSplit: true,
      chunkSizeWarningLimit: 1000,
      minify: 'terser',
      sourcemap: false,
      terserOptions: {
        compress: {
          drop_console: mode === 'production',
          drop_debugger: mode === 'production',
          pure_funcs: mode === 'production' ? ['console.log', 'console.info'] : [],
          reduce_vars: true,
          collapse_vars: true,
          passes: 2,
        },
        format: {
          comments: false,
        },
        mangle: {
          safari10: true,
        },
      },
      rollupOptions: {
        onwarn(warning) {
          if (warning.code === 'CIRCULAR_DEPENDENCY') return
          if (warning.message?.includes('Circular chunk')) return
          console.warn(warning.message || warning)
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              const pkgMatch = id.match(/node_modules[\/\\](@[^\/\\]+[\/\\][^\/\\]+|[^\/\\]+)/)
              const pkg = pkgMatch ? pkgMatch[1] : ''

              if (
                pkg === 'react' ||
                pkg === 'react-dom' ||
                pkg === 'scheduler' ||
                pkg === 'react-router' ||
                pkg === 'react-router-dom' ||
                pkg === '@babel/runtime'
              ) {
                return 'vendor-react'
              }

              if (pkg === 'echarts' || pkg.startsWith('echarts/')) return 'vendor-echarts'
              if (pkg === 'vis-network' || pkg.startsWith('vis-network/')) return 'vendor-vis'
              if (pkg === '@uiw/react-md-editor' || pkg === '@uiw/react-markdown-preview') {
                return 'vendor-md-editor'
              }
              if (pkg === 'lucide-react' || pkg.startsWith('lucide-react/')) return 'vendor-icons'
              if (['motion', 'motion-dom', 'motion-utils', 'framer-motion'].includes(pkg)) {
                return 'vendor-motion'
              }
              if (
                pkg === 'react-markdown' ||
                pkg.startsWith('remark-') ||
                pkg.startsWith('rehype-') ||
                pkg === 'unified' ||
                pkg === 'refractor' ||
                pkg === 'micromark' ||
                pkg.startsWith('micromark-') ||
                pkg.startsWith('mdast-util-') ||
                pkg.startsWith('hast-util-') ||
                pkg === 'parse5' ||
                pkg.startsWith('unist-util-') ||
                pkg.startsWith('vfile') ||
                pkg === 'property-information' ||
                pkg === 'lowlight' ||
                pkg === 'highlight.js'
              ) {
                return 'vendor-markdown'
              }

              return 'vendor'
            }

            if (id.includes('/src/pages/')) {
              if (id.includes('/pages/Admin')) return 'page-admin'
              if (id.includes('/pages/Forum')) return 'page-forum'
              if (id.includes('/pages/Music')) return 'page-music'
              if (id.includes('/pages/Gallery')) return 'page-gallery'
              if (id.includes('/pages/Search')) return 'page-search'
              if (id.includes('GalleryDetail')) return 'page-gallery-detail'
              if (id.includes('MusicDetail')) return 'page-music-detail'
              if (id.includes('AlbumDetail')) return 'page-album-detail'
              if (id.includes('MusicLinks')) return 'page-music-links'
            }
          },
          entryFileNames: `assets/v5-[name]-[hash].js`,
          chunkFileNames: `assets/v5-[name]-[hash].js`,
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name || ''
            if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(info)) {
              return 'assets/images/[name]-[hash][extname]'
            }
            if (/\.(woff2?|ttf|otf|eot)$/i.test(info)) {
              return 'assets/fonts/[name]-[hash][extname]'
            }
            if (/\.css$/i.test(info)) {
              return 'assets/css/[name]-[hash][extname]'
            }
            return 'assets/[name]-[hash][extname]'
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  }
})
