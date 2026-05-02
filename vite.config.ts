import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, type PluginOption } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(({ mode }) => {
	const isAnalyze = process.env.ANALYZE === "true";

	return {
		plugins: [
			react(),
			tailwindcss(),
			// Bundle analyzer - only enabled when ANALYZE=true
			isAnalyze &&
				visualizer({
					open: true,
					gzipSize: true,
					brotliSize: true,
					filename: "dist/stats.html",
				}) as PluginOption,
		].filter(Boolean),
		build: {
			target: "es2020",
			// Enable CSS code splitting
			cssCodeSplit: true,
			// Optimize chunk size warnings threshold (500kb)
			chunkSizeWarningLimit: 500,
			// Minification options
			minify: "terser",
			terserOptions: {
				compress: {
					drop_console: mode === "production",
					drop_debugger: mode === "production",
					pure_funcs: mode === "production" ? ["console.log", "console.info"] : [],
				},
				format: {
					comments: false,
				},
			},
			rollupOptions: {
				output: {
					// Optimize chunk splitting for route-level code splitting
					manualChunks(id) {
						// Route components - split into separate chunks for lazy loading
						if (id.includes("/src/pages/")) {
							// Admin page is large and rarely accessed - always split it
							if (id.includes("/pages/Admin")) {
								return "page-admin";
							}
							// Other page chunks
							if (id.includes("/pages/Forum")) return "page-forum";
							if (id.includes("/pages/Music")) return "page-music";
							if (id.includes("/pages/Gallery")) return "page-gallery";
							if (id.includes("/pages/Search")) return "page-search";
							// Detail pages
							if (id.includes("GalleryDetail")) return "page-gallery-detail";
							if (id.includes("MusicDetail")) return "page-music-detail";
							if (id.includes("AlbumDetail")) return "page-album-detail";
							if (id.includes("MusicLinks")) return "page-music-links";
						}

						if (!id.includes("node_modules")) return;

						const pkgMatch = id.match(
							/node_modules[\/\\](@[^\/\\]+[\/\\][^\/\\]+|[^\/\\]+)/,
						);
						const pkg = pkgMatch ? pkgMatch[1] : "";

						// React core - most critical, keep together
						if (
							pkg === "react" ||
							pkg === "react-dom" ||
							pkg === "scheduler" ||
							pkg === "react-router" ||
							pkg === "react-router-dom"
						) {
							return "react-core";
						}

						// Markdown processing - large dependencies
						if (
							pkg === "react-markdown" ||
							pkg === "react-markdown-editor-lite" ||
							pkg === "markdown-it" ||
							pkg.startsWith("rehype-") ||
							pkg.startsWith("remark-")
						) {
							return "markdown-vendor";
						}

						// Animation libraries
						if (
							pkg === "motion" ||
							pkg === "motion-dom" ||
							pkg === "motion-utils" ||
							pkg === "framer-motion"
						) {
							return "motion-vendor";
						}

						// Icons
						if (pkg === "lucide-react") return "icons-vendor";

						// AI/ML libraries - often large
						if (
							pkg === "@google/genai" ||
							pkg === "@huggingface/transformers" ||
							pkg.startsWith("@tensorflow")
						) {
							return "ai-vendor";
						}

						// Date utilities
						if (pkg === "date-fns") return "date-vendor";

						// Image processing
						if (
							pkg === "exifreader" ||
							pkg === "react-image-crop" ||
							pkg === "spark-md5" ||
							pkg === "blurhash"
						) {
							return "image-vendor";
						}

						// Charts and visualization
						if (
							pkg === "echarts" ||
							pkg === "vis-network" ||
							pkg.startsWith("vis-")
						) {
							return "chart-vendor";
						}

						// AWS SDK - large dependencies
						if (pkg.startsWith("@aws-sdk/")) {
							return "aws-vendor";
						}

						// Utilities
						if (
							pkg === "zod" ||
							pkg === "axios" ||
							pkg === "cheerio"
						) {
							return "utils-vendor";
						}

						// Database/ORM related
						if (
							pkg === "@prisma/client" ||
							pkg === "@qdrant/js-client-rest"
						) {
							return "db-vendor";
						}

						// Everything else
						return "vendor-misc";
					},
					// Optimized file naming with content hash for better caching
					entryFileNames: "assets/[name]-[hash].js",
					chunkFileNames: "assets/[name]-[hash].js",
					assetFileNames: (assetInfo) => {
						const info = assetInfo.name || "";
						// Images
						if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(info)) {
							return "assets/images/[name]-[hash][extname]";
						}
						// Fonts
						if (/\.(woff2?|ttf|otf|eot)$/i.test(info)) {
							return "assets/fonts/[name]-[hash][extname]";
						}
						// CSS
						if (/\.css$/i.test(info)) {
							return "assets/css/[name]-[hash][extname]";
						}
						// Other assets
						return "assets/[name]-[hash][extname]";
					},
				},
			},
		},
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "."),
			},
		},
		server: {
			hmr: process.env.DISABLE_HMR !== "true",
		},
	};
});
