import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { customSchema, isTrustedIframeDomain } from "../../lib/htmlSanitizer";
import WikiLinkPreview from "../../components/WikiLinkPreview";

const WikiMarkdown = ({ content }: { content: string }) => {
	const processedContent = useMemo(() => {
		return content.replace(
			/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
			(_match, p1, p2) => {
				const display = p1.trim();
				const slug = p2 ? p2.trim() : p1.trim();
				return `[${display}](${`/wiki/${slug}`})`;
			},
		);
	}, [content]);

	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			rehypePlugins={[rehypeRaw, [rehypeSanitize, customSchema]]}
			components={{
				iframe: ({
					src,
					width,
					height,
					...props
				}: React.IframeHTMLAttributes<HTMLIFrameElement>) => {
					if (!isTrustedIframeDomain(src)) {
						return null;
					}
					return (
						<iframe
							src={src}
							width={width || "100%"}
							height={height || "400px"}
							{...props}
						/>
					);
				},
				a: ({ href, children, ...props }) => {
					if (href?.startsWith("/wiki/")) {
						const rawSlug = href.replace("/wiki/", "");
						const slug = rawSlug.split("?")[0];
						const themedHref = href;
						return (
							<WikiLinkPreview slug={slug}>
								<Link
									to={themedHref}
									className="text-[#c8951e] font-bold hover:underline decoration-[#c8951e]/30 underline-offset-4"
									{...props}
								>
									{children}
								</Link>
							</WikiLinkPreview>
						);
					}
					return (
						<a
							href={href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-[#c8951e] hover:underline"
							{...props}
						>
							{children}
						</a>
					);
				},
				table: ({ children }) => (
					<div className="overflow-x-auto my-8">
						<table className="w-full border-collapse border border-gray-200 rounded overflow-hidden">
							{children}
						</table>
					</div>
				),
				thead: ({ children }) => (
					<thead className="bg-[#f7f5f0]/50 text-[#c8951e]">
						{children}
					</thead>
				),
				th: ({ children }) => (
					<th className="border border-gray-200 px-4 py-3 text-left font-bold">
						{children}
					</th>
				),
				td: ({ children }) => (
					<td className="border border-gray-200 px-4 py-3">{children}</td>
				),
				tr: ({ children }) => (
					<tr className="hover:bg-[#f7f5f0] transition-colors">{children}</tr>
				),
			}}
		>
			{processedContent}
		</ReactMarkdown>
	);
};

export default WikiMarkdown;
