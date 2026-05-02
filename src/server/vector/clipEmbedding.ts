import { RawImage, pipeline, CLIPTextModelWithProjection, CLIPTokenizer, env } from '@huggingface/transformers';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const DEFAULT_MODEL_NAME = 'Xenova/clip-vit-base-patch32';
const DEFAULT_VECTOR_SIZE = 512;

// 配置 transformers 环境
// 设置模型缓存目录
const MODEL_CACHE_DIR = process.env.TRANSFORMERS_CACHE || path.join(process.cwd(), 'models', 'transformers');
env.cacheDir = MODEL_CACHE_DIR;

// 如果使用本地模型，设置本地模型路径
if (process.env.TRANSFORMERS_OFFLINE === 'true') {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
}

type TensorLike = {
  data?: ArrayLike<number>;
};

type ExtractorFunc = (
  input: unknown,
  options?: {
    pooling?: 'mean';
    normalize?: boolean;
  },
) => Promise<TensorLike>;

let imageExtractorPromise: Promise<ExtractorFunc> | null = null;
let textModelPromise: Promise<CLIPTextModelWithProjection> | null = null;
let textTokenizerPromise: Promise<CLIPTokenizer> | null = null;
let modelLoadError: Error | null = null;
let isUsingModelScope = false;

function parseInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

export function getEmbeddingModelName() {
  return process.env.IMAGE_EMBEDDING_MODEL || DEFAULT_MODEL_NAME;
}

export function getEmbeddingVectorSize() {
  return parseInteger(process.env.IMAGE_EMBEDDING_VECTOR_SIZE, DEFAULT_VECTOR_SIZE);
}

export function getModelCacheDir() {
  return MODEL_CACHE_DIR;
}

export function isModelLoaded() {
  return imageExtractorPromise !== null && modelLoadError === null;
}

export function getModelLoadError() {
  return modelLoadError;
}

export function isModelScopeActive() {
  return isUsingModelScope;
}

function isNetworkError(error: Error): boolean {
  const errorMessage = error.message?.toLowerCase() || '';
  return (
    errorMessage.includes('fetch failed') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('etimedout') ||
    errorMessage.includes('enotfound') ||
    errorMessage.includes('network') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('abort')
  );
}

function getModelLocalPath(modelName: string): string | null {
  console.log(`[CLIP] 查找本地模型: ${modelName}`);
  console.log(`[CLIP] 缓存目录: ${MODEL_CACHE_DIR}`);
  
  // 检查模型是否已存在于本地缓存 (Hugging Face 格式)
  const hfModelDir = path.join(MODEL_CACHE_DIR, 'models--' + modelName.replace('/', '--'));
  console.log(`[CLIP] 检查 Hugging Face 格式路径: ${hfModelDir}, 存在: ${fs.existsSync(hfModelDir)}`);
  if (fs.existsSync(hfModelDir)) {
    console.log(`[CLIP] 找到 Hugging Face 格式模型: ${hfModelDir}`);
    return hfModelDir;
  }
  
  // 检查 ModelScope 下载的模型路径
  const modelScopeDir = path.join(MODEL_CACHE_DIR, modelName);
  console.log(`[CLIP] 检查 ModelScope 格式路径: ${modelScopeDir}, 存在: ${fs.existsSync(modelScopeDir)}`);
  
  if (fs.existsSync(modelScopeDir)) {
    // 检查目录内容，确保模型文件存在
    try {
      const files = fs.readdirSync(modelScopeDir);
      console.log(`[CLIP] 模型目录内容: ${files.join(', ')}`);
      
      const hasConfig = files.includes('config.json');
      const onnxPath = path.join(modelScopeDir, 'onnx');
      const hasOnnx = files.includes('onnx') && fs.existsSync(onnxPath);
      
      console.log(`[CLIP] 文件检查: config.json=${hasConfig}, onnx目录=${hasOnnx}`);
      
      if (hasConfig && hasOnnx) {
        console.log(`[CLIP] 找到完整 ModelScope 格式模型: ${modelScopeDir}`);
        return modelScopeDir;
      } else {
        console.warn(`[CLIP] 模型目录存在但文件不完整`);
        console.warn(`[CLIP] 缺失: config.json=${!hasConfig}, onnx=${!hasOnnx}`);
      }
    } catch (err) {
      console.error(`[CLIP] 读取模型目录失败:`, err);
    }
  }
  
  // 额外检查：直接检查 Xenova/clip-vit-base-patch32 路径
  const directPath = path.join(MODEL_CACHE_DIR, 'Xenova', 'clip-vit-base-patch32');
  console.log(`[CLIP] 检查直接路径: ${directPath}, 存在: ${fs.existsSync(directPath)}`);
  if (fs.existsSync(directPath)) {
    const files = fs.readdirSync(directPath);
    const hasConfig = files.includes('config.json');
    const hasOnnx = files.includes('onnx');
    
    if (hasConfig && hasOnnx) {
      console.log(`[CLIP] 找到直接路径模型: ${directPath}`);
      return directPath;
    }
  }
  
  console.log(`[CLIP] 未找到本地模型`);
  return null;
}

async function downloadFromModelScope(modelName: string): Promise<string> {
  console.log(`[CLIP] 尝试使用 ModelScope 下载模型: ${modelName}`);

  const targetDir = path.join(MODEL_CACHE_DIR, modelName);

  // 检查是否已存在
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    console.log(`[CLIP] 模型已存在于: ${targetDir}`);
    isUsingModelScope = true;
    return targetDir;
  }

  // 确保父目录存在
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

  const errors: string[] = [];

  // 方法1: 尝试使用 modelscope CLI 下载
  try {
    console.log(`[CLIP] 方法1: 使用 modelscope CLI 下载模型...`);
    execSync(`modelscope download --model ${modelName} --local_dir "${targetDir}"`, {
      stdio: 'pipe',
      timeout: 300000, // 5分钟超时
    });
    console.log(`[CLIP] ModelScope CLI 下载成功: ${targetDir}`);
    isUsingModelScope = true;
    return targetDir;
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误';
    console.warn(`[CLIP] ModelScope CLI 下载失败: ${msg}`);
    errors.push(`CLI: ${msg}`);
  }

  // 方法2: 尝试使用 Python SDK 下载
  try {
    console.log(`[CLIP] 方法2: 使用 Python SDK 下载模型...`);
    const pythonScript = `
import sys
sys.path.insert(0, '/usr/local/lib/python3.10/dist-packages')
sys.path.insert(0, '/usr/lib/python3/dist-packages')
from modelscope import snapshot_download
import os
model_dir = snapshot_download('${modelName}', cache_dir='${path.dirname(targetDir)}')
print(f"DOWNLOADED_TO: {model_dir}")
`;
    const result = execSync(`python3 -c "${pythonScript}"`, {
      stdio: 'pipe',
      timeout: 600000, // 10分钟超时
      encoding: 'utf-8',
    });

    // 解析下载路径
    const match = result.match(/DOWNLOADED_TO:\s*(.+)/);
    if (match) {
      const downloadedPath = match[1].trim();
      console.log(`[CLIP] Python SDK 下载成功: ${downloadedPath}`);
      isUsingModelScope = true;
      return downloadedPath;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误';
    console.warn(`[CLIP] Python SDK 下载失败: ${msg}`);
    errors.push(`Python SDK: ${msg}`);
  }

  // 方法3: 尝试使用 Git LFS 克隆
  try {
    console.log(`[CLIP] 方法3: 使用 Git LFS 克隆模型...`);
    // 清理之前的失败尝试
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    execSync(`git lfs install`, { stdio: 'pipe' });
    execSync(`git clone https://www.modelscope.cn/${modelName}.git "${targetDir}"`, {
      stdio: 'pipe',
      timeout: 600000, // 10分钟超时
    });

    if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
      console.log(`[CLIP] Git LFS 克隆成功: ${targetDir}`);
      isUsingModelScope = true;
      return targetDir;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误';
    console.warn(`[CLIP] Git LFS 克隆失败: ${msg}`);
    errors.push(`Git: ${msg}`);
  }

  // 所有方法都失败了
  throw new Error(
    `ModelScope 下载失败，已尝试以下方法:\n` +
    errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n') +
    `\n\n请手动下载模型:\n` +
    `1. 安装 ModelScope: pip install modelscope\n` +
    `2. 下载模型: modelscope download --model ${modelName} --local_dir "${targetDir}"\n` +
    `3. 或使用 Git: git clone https://www.modelscope.cn/${modelName}.git "${targetDir}"\n` +
    `4. 或使用 Hugging Face 镜像: https://hf-mirror.com/${modelName}`
  );
}

async function loadModelWithFallback<T>(
  modelName: string,
  loadFn: (modelPath: string) => Promise<T>,
  modelType: string
): Promise<T> {
  // 首先检查本地是否已有模型
  const localPath = getModelLocalPath(modelName);
  if (localPath) {
    console.log(`[CLIP] 使用本地模型: ${localPath}`);
    try {
      return await loadFn(localPath);
    } catch (error) {
      console.warn(`[CLIP] 本地模型加载失败，尝试重新下载:`, error);
    }
  }
  
  // 尝试从 Hugging Face 下载
  try {
    console.log(`[CLIP] 尝试从 Hugging Face 加载${modelType}`);
    isUsingModelScope = false;
    return await loadFn(modelName);
  } catch (error) {
    if (!isNetworkError(error as Error)) {
      throw error;
    }
    console.warn(`[CLIP] 从 Hugging Face 加载${modelType}失败，准备使用 ModelScope`);
  }
  
  // 使用 ModelScope 下载并加载
  const modelScopePath = await downloadFromModelScope(modelName);
  console.log(`[CLIP] 从 ModelScope 加载${modelType}: ${modelScopePath}`);
  return await loadFn(modelScopePath);
}

async function getImageExtractor() {
  if (modelLoadError) {
    throw new Error(`模型加载失败: ${modelLoadError.message}`);
  }

  if (!imageExtractorPromise) {
    const modelName = getEmbeddingModelName();
    console.log(`[CLIP] 正在加载图像特征提取模型: ${modelName}`);
    console.log(`[CLIP] 模型缓存目录: ${MODEL_CACHE_DIR}`);

    imageExtractorPromise = loadModelWithFallback(
      modelName,
      async (modelPath) => {
        // 判断是否是本地路径（包含 / 且目录存在）
        const isLocalPath = modelPath.includes('/') && fs.existsSync(modelPath);
        console.log(`[CLIP] 加载图像模型，路径: ${modelPath}, 本地模式: ${isLocalPath}`);
        const extractor = await pipeline('image-feature-extraction', modelPath, {
          cache_dir: MODEL_CACHE_DIR,
          local_files_only: isLocalPath,
        });
        return extractor as ExtractorFunc;
      },
      '图像特征提取模型'
    )
      .then((extractor) => {
        console.log(`[CLIP] 图像特征提取模型加载成功`);
        modelLoadError = null;
        return extractor;
      })
      .catch((error) => {
        console.error(`[CLIP] 图像特征提取模型加载失败:`, error);
        modelLoadError = error;
        imageExtractorPromise = null;

        // 提供更友好的错误信息
        if (isNetworkError(error)) {
          throw new Error(
            `模型下载失败: 无法连接到 Hugging Face 或 ModelScope 服务器。\n` +
            `请检查网络连接，或手动下载模型:\n` +
            `1. 安装 ModelScope: pip install modelscope\n` +
            `2. 下载模型: modelscope download --model ${modelName} --local_dir "${path.join(MODEL_CACHE_DIR, modelName)}"\n` +
            `3. 或使用 Git: git clone https://www.modelscope.cn/${modelName}.git\n` +
            `原始错误: ${error.message}`
          );
        }
        throw error;
      });
  }
  return imageExtractorPromise;
}

async function getTextModel() {
  if (modelLoadError) {
    throw new Error(`模型加载失败: ${modelLoadError.message}`);
  }

  if (!textModelPromise) {
    const modelName = getEmbeddingModelName();
    console.log(`[CLIP] 正在加载文本模型: ${modelName}`);

    textModelPromise = loadModelWithFallback(
      modelName,
      async (modelPath) => {
        const isLocalPath = modelPath.includes('/') && fs.existsSync(modelPath);
        console.log(`[CLIP] 加载文本模型，路径: ${modelPath}, 本地模式: ${isLocalPath}`);
        return await CLIPTextModelWithProjection.from_pretrained(modelPath, {
          cache_dir: MODEL_CACHE_DIR,
          local_files_only: isLocalPath,
        });
      },
      '文本模型'
    )
      .then((model) => {
        console.log(`[CLIP] 文本模型加载成功`);
        return model;
      })
      .catch((error) => {
        console.error(`[CLIP] 文本模型加载失败:`, error);
        modelLoadError = error;
        textModelPromise = null;
        throw error;
      });
  }
  return textModelPromise;
}

async function getTextTokenizer() {
  if (modelLoadError) {
    throw new Error(`模型加载失败: ${modelLoadError.message}`);
  }

  if (!textTokenizerPromise) {
    const modelName = getEmbeddingModelName();
    console.log(`[CLIP] 正在加载文本分词器: ${modelName}`);

    textTokenizerPromise = loadModelWithFallback(
      modelName,
      async (modelPath) => {
        const isLocalPath = modelPath.includes('/') && fs.existsSync(modelPath);
        console.log(`[CLIP] 加载分词器，路径: ${modelPath}, 本地模式: ${isLocalPath}`);
        return await CLIPTokenizer.from_pretrained(modelPath, {
          cache_dir: MODEL_CACHE_DIR,
          local_files_only: isLocalPath,
        });
      },
      '文本分词器'
    )
      .then((tokenizer) => {
        console.log(`[CLIP] 文本分词器加载成功`);
        return tokenizer;
      })
      .catch((error) => {
        console.error(`[CLIP] 文本分词器加载失败:`, error);
        modelLoadError = error;
        textTokenizerPromise = null;
        throw error;
      });
  }
  return textTokenizerPromise;
}

export async function generateImageEmbedding(imageBuffer: Buffer) {
  if (!imageBuffer || imageBuffer.byteLength === 0) {
    throw new Error('图片内容为空，无法生成向量');
  }

  const extractor = await getImageExtractor();
  const tmpPath = path.join(os.tmpdir(), `embedding_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await fs.promises.writeFile(tmpPath, imageBuffer);
    const image = await RawImage.read(tmpPath);
    const output = await extractor(image, {
      pooling: 'mean',
      normalize: true,
    });

    const vectorData = output.data;
    if (!vectorData) {
      throw new Error('未获取到图像向量数据');
    }

    const vector = normalizeVector(Array.from(vectorData));
    const expectedSize = getEmbeddingVectorSize();
    if (vector.length !== expectedSize) {
      throw new Error(`向量维度异常: expected=${expectedSize}, actual=${vector.length}`);
    }

    return vector;
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

export async function generateTextEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('文本内容为空，无法生成向量');
  }

  const model = await getTextModel();
  const tokenizer = await getTextTokenizer();

  const outputs = await model.forward(tokenizer(text));
  const vectorData = outputs.text_embeds.data;

  if (!vectorData) {
    throw new Error('未获取到文本向量数据');
  }

  const vector = normalizeVector(Array.from(vectorData));
  const expectedSize = getEmbeddingVectorSize();
  if (vector.length !== expectedSize) {
    throw new Error(`向量维度异常: expected=${expectedSize}, actual=${vector.length}`);
  }

  return vector;
}
