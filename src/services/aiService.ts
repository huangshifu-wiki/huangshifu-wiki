import { GoogleGenAI } from "@google/genai";

// L-25 安全评估: VITE_GEMINI_API_KEY 为 VITE_ 前缀，会被 Vite 打包到前端 JS bundle
// 风险等级: MEDIUM — 密钥暴露在客户端，任何用户可通过 DevTools 查看
// 缓解措施:
//   1. 生产环境使用 Google AI Studio 的 API Key 限制（HTTP Referer/IP 限额）
//   2. 定期轮换密钥
//   3. 考虑未来迁移到后端代理模式（通过 /api/ai 端点转发请求）
// 当前方案可接受范围: 内部 Wiki 项目 + 低流量场景

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const summarizeWikiContent = async (content: string) => {
  if (!ai) {
    console.warn('Gemini API key is missing. summarizeWikiContent is disabled.');
    return null;
  }
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `请为以下关于歌手黄诗扶的内容生成一段简短、优美且具有百科风格的摘要（约100-200字）：\n\n${content}`,
      config: {
        systemInstruction: "你是一个专业的音乐百科编辑，擅长用优美、客观且专业的语言描述歌手及其作品。",
      },
    });
    return response.text;
  } catch (error) {
    console.error("AI Summarization error:", error);
    return null;
  }
};

export const generateWikiIntro = async (topic: string) => {
  if (!ai) {
    console.warn('Gemini API key is missing. generateWikiIntro is disabled.');
    return null;
  }
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `请为“${topic}”这个主题生成一段关于歌手黄诗扶的百科介绍开头。要求包含基本信息、艺术特色，并使用Markdown格式。`,
      config: {
        systemInstruction: "你是一个黄诗扶的资深粉丝和百科编辑，对她的音乐风格（古风、流行、戏腔等）有深入了解。",
      },
    });
    return response.text;
  } catch (error) {
    console.error("AI Generation error:", error);
    return null;
  }
};

export const describeImageForSearch = async (base64Image: string, mimeType: string) => {
  if (!ai) {
    console.warn('Gemini API key is missing. describeImageForSearch is disabled.');
    return null;
  }
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: "请描述这张图片中的内容，特别是如果它与歌手黄诗扶、古风音乐、舞台表演或艺术作品相关。请提供几个关键词，以便我可以在数据库中搜索相关内容。请只返回关键词，用空格分隔。",
          },
        ],
      },
      config: {
        systemInstruction: "你是一个专业的图像识别助手，擅长识别与中国古风音乐、歌手黄诗扶相关的视觉元素。",
      },
    });
    return response.text;
  } catch (error) {
    console.error("AI Image Description error:", error);
    return null;
  }
};
