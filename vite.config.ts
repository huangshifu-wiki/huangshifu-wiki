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
				// Suppress circular chunk warning - this is a known issue with complex dependency graphs
				// The circular reference is between UI libraries and misc utilities, which is unavoidable
				// without merging all dependencies into a single large chunk (which would hurt caching)
				onwarn(warning) {
					if (warning.code === 'CIRCULAR_DEPENDENCY') return;
					if (warning.message?.includes('Circular chunk')) return;
					console.warn(warning.message || warning);
				},
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

						// React core - most critical, keep together with babel runtime
						if (
							pkg === "react" ||
							pkg === "react-dom" ||
							pkg === "scheduler" ||
							pkg === "react-router" ||
							pkg === "react-router-dom" ||
							pkg === "@babel/runtime"
						) {
							return "react-core";
						}

						// UI libraries - grouped together to avoid circular dependencies
						// Includes markdown editors, animation, icons, and their dependencies
						if (
							pkg === "react-markdown" ||
							pkg === "@uiw/react-md-editor" ||
							pkg.startsWith("@uiw/") ||
							pkg.startsWith("rehype-") ||
							pkg.startsWith("remark-") ||
							pkg.startsWith("unist-") ||
							pkg.startsWith("mdast-") ||
							pkg.startsWith("hast") ||
							pkg === "motion" ||
							pkg === "motion-dom" ||
							pkg === "motion-utils" ||
							pkg === "framer-motion" ||
							pkg === "lucide-react" ||
							// Common utilities that UI libs depend on
							pkg === "prismjs" ||
							pkg === "tslib" ||
							pkg === "bail" ||
							pkg === "extend" ||
							pkg === "character-entities" ||
							pkg === "property-information" ||
							pkg === "comma-separated-tokens" ||
							pkg === "space-separated-tokens" ||
							pkg === "hastscript" ||
							pkg === "web-namespaces"
						) {
							return "vendor-ui";
						}

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

						// Charts and visualization - large bundle, keep separate
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

						// Database/ORM related
						if (
							pkg === "@prisma/client" ||
							pkg === "@qdrant/js-client-rest"
						) {
							return "db-vendor";
						}

						// Common utilities and smaller libraries that don't fit other categories
						if (
							pkg === "zod" ||
							pkg === "axios" ||
							pkg === "cheerio" ||
							pkg === "clsx" ||
							pkg === "tailwind-merge"
						) {
							return "utils-vendor";
						}

						// CSS/HTML parsing libraries - often have circular dependencies and ES module issues
						if (
							pkg === "css-selector-parser" ||
							pkg.startsWith("css-") ||
							pkg === "parse5" ||
							pkg === "htmlparser2" ||
							pkg === "domhandler" ||
							pkg === "domutils" ||
							pkg === "entities" ||
							pkg === "domelementtype"
						) {
							return "parser-vendor";
						}

						// Encoding and utility libraries
						if (
							pkg === "iconv-lite" ||
							pkg === "whatwg-url" ||
							pkg === "tr46" ||
							pkg.startsWith("punycode")
						) {
							return "encoding-vendor";
						}

						// Music parsing libraries
						if (
							pkg === "@meting/core" ||
							pkg.startsWith("@meting/")
						) {
							return "music-vendor";
						}

						// Compression and archive libraries
						if (
							pkg === "adm-zip" ||
							pkg === "archiver" ||
							pkg.startsWith("zip") ||
							pkg.startsWith("tar") ||
							pkg === "compress-commons"
						) {
							return "compress-vendor";
						}

						// Native/WASM runtime libraries
						if (
							pkg === "@emnapi/runtime" ||
							pkg === "@emnapi/" ||
							pkg.startsWith("wasm-") ||
							pkg === "onnxruntime-node" ||
							pkg.startsWith("onnxruntime")
						) {
							return "runtime-vendor";
						}

						// Sharp and image processing
						if (
							pkg === "sharp" ||
							pkg.startsWith("sharp-") ||
							pkg === "@img/" ||
							pkg === "color"
						) {
							return "sharp-vendor";
						}

						// Node.js polyfills and core modules
						if (
							pkg === "node-fetch" ||
							pkg === "data-uri-to-buffer" ||
							pkg === "fetch-blob" ||
							pkg === "formdata-polyfill" ||
							pkg === "node-domexception" ||
							pkg === "web-streams-polyfill"
						) {
							return "polyfill-vendor";
						}

						// Security and crypto libraries
						if (
							pkg === "jsonwebtoken" ||
							pkg === "bcryptjs" ||
							pkg === "cookie-parser" ||
							pkg === "helmet" ||
							pkg === "cors"
						) {
							return "security-vendor";
						}

						// Everything else goes to misc (should be much smaller now)
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
