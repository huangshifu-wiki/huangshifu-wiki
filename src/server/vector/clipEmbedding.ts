import { RawImage, pipeline, CLIPTextModelWithProjection, CLIPTokenizer, ChineseCLIPModel, AutoTokenizer, env, PreTrainedTokenizer } from '@huggingface/transformers'
import type { DataType } from '@huggingface/transformers'
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, execSync } from 'child_process';

const DEFAULT_MODEL_NAME = 'OFA-Sys/chinese-clip-vit-base-patch16'
const DEFAULT_VECTOR_SIZE = 512

// 配置 transformers 环境
// 设置模型缓存目录
const MODEL_CACHE_DIR = process.env.TRANSFORMERS_CACHE || path.join(process.cwd(), 'models', 'transformers');
env.cacheDir = MODEL_CACHE_DIR;


// 设置远程模型下载超时（毫秒）
(env as unknown as Record<string, unknown>).remoteHostTimeout = 5000;

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

let imageExtractorPromise: Promise<ExtractorFunc> | null = null
let textModelPromise: Promise<CLIPTextModelWithProjection | ChineseCLIPModel> | null = null
let textTokenizerPromise: Promise<CLIPTokenizer | PreTrainedTokenizer> | null = null
let imageModelError: Error | null = null
let textModelError: Error | null = null
let textTokenizerError: Error | null = null
let isUsingModelScope = false
let cachedModelType: 'chinese_clip' | 'clip' | null = null
let actualDtypeUsed: DataType | null = null

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
    throw new Error('Zero vector detected, cannot normalize');
  }
  return vector.map((value) => value / magnitude);
}

export function getEmbeddingModelName() {
  return process.env.IMAGE_EMBEDDING_MODEL || DEFAULT_MODEL_NAME;
}

export function getEmbeddingVectorSize() {
  return parseInteger(process.env.IMAGE_EMBEDDING_VECTOR_SIZE, DEFAULT_VECTOR_SIZE)
}

export function getEmbeddingDtype(): DataType {
  return (process.env.IMAGE_EMBEDDING_DTYPE || 'q8') as DataType
}

export function getModelCacheDir() {
  return MODEL_CACHE_DIR;
}

export function isImageModelLoaded() {
  return imageExtractorPromise !== null && imageModelError === null
}

export function isTextModelLoaded() {
  return textModelPromise !== null && textModelError === null
}

export function isTokenizerLoaded() {
  return textTokenizerPromise !== null && textTokenizerError === null
}

export function getModelLoadError() {
  return { image: imageModelError, text: textModelError, tokenizer: textTokenizerError }
}

export function getActualDtype(): DataType {
  return actualDtypeUsed || getEmbeddingDtype()
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
  )
}

let hfReachabilityCache: boolean | null = null;
const HF_PROBE_URL = 'https://huggingface.co';
const DEFAULT_HF_PROBE_TIMEOUT = 5000;

export async function probeHuggingFaceReachability(): Promise<boolean> {
  if (hfReachabilityCache !== null) {
    return hfReachabilityCache;
  }

  const timeout = parseInteger(process.env.HF_PROBE_TIMEOUT_MS, DEFAULT_HF_PROBE_TIMEOUT);

  if (process.env.TRANSFORMERS_OFFLINE === 'true' || process.env.SKIP_NETWORK_PROBE === 'true') {
    console.log('[CLIP] 网络探测已跳过 (离线模式或 SKIP_NETWORK_PROBE=true)');
    hfReachabilityCache = false;
    return false;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(HF_PROBE_URL, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timer);
    const reachable = response.ok || response.status < 500;
    console.log(`[CLIP] HuggingFace 可达性检测: ${reachable ? '可达' : '不可达'} (${response.status}, ${timeout}ms 超时)`);
    hfReachabilityCache = reachable;
    return reachable;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`[CLIP] HuggingFace 不可达 (${msg})，将使用备用源`);
    hfReachabilityCache = false;
    return false;
  }
}

export function getHfReachability(): boolean | null {
  return hfReachabilityCache;
}

function findOnnxFiles(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.onnx') && !f.includes('.q8.'));
    return files.map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

async function quantizeModelIfNeeded(onnxModelPath: string): Promise<string> {
  const q8Path = onnxModelPath.replace(/\.onnx$/, '.q8.onnx');

  if (fs.existsSync(q8Path)) {
    console.log(`[CLIP] 已存在 int8 量化模型: ${q8Path}`);
    return q8Path;
  }

  if (!fs.existsSync(onnxModelPath)) {
    return onnxModelPath;
  }

  const dtype = getEmbeddingDtype();
  if (dtype !== 'q8') {
    return onnxModelPath;
  }

  console.log(`[CLIP] 首次运行，正在对模型进行 int8 动态量化...`);
  console.log(`[CLIP] 源文件: ${onnxModelPath} → 目标: ${q8Path}`);

  try {
    const pythonScript = [
      'import sys, os',
      'sys.path.insert(0, os.path.join(sys.argv[3], "node_modules"))',
      'try:',
      '    from onnxruntime.quantization import quantize_dynamic, QuantType',
      '    quantize_dynamic(',
      '      sys.argv[1],',
      '      sys.argv[2],',
      '      weight_type=QuantType.QUInt8)',
      '    )',
      '    print("OK")',
      'except ImportError:',
      '    print("NO_ORT")',
      'except Exception as e:',
      '    print(f"ERROR:{e}")',
    ].join('\n');

    const tempScriptPath = path.join(os.tmpdir(), `quantize_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    await fs.promises.writeFile(tempScriptPath, pythonScript, 'utf-8');

    let result: string;
    try {
      result = execFileSync('python', [tempScriptPath, onnxModelPath, q8Path, process.cwd()], {
        timeout: 120000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
      });
    } finally {
      await fs.promises.unlink(tempScriptPath).catch(() => {});
    }

    if (result.includes('OK') && fs.existsSync(q8Path)) {
      const stats = fs.statSync(q8Path);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
      console.log(`[CLIP] 动态量化完成: ${q8Path} (~${sizeMB}MB)`);
      return q8Path;
    } else if (result.includes('NO_ORT')) {
      console.warn('[CLIP] Python onnxruntime 未安装，跳过动态量化（将使用 fp32 模型）');
      return onnxModelPath;
    } else {
      throw new Error(result.trim());
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[CLIP] 动态量化失败，回退到 fp32 模型: ${msg}`);
    return onnxModelPath;
  }
}

async function detectModelType(modelPath: string): Promise<'chinese_clip' | 'clip'> {
  if (cachedModelType !== null) {
    return cachedModelType
  }
  const configPath = path.join(modelPath, 'config.json')
  try {
    const raw = await fs.promises.readFile(configPath, 'utf-8')
    const config = JSON.parse(raw)
    const modelType = config.model_type
    if (modelType === 'chinese_clip') {
      console.log(`[CLIP] 检测到模型架构: chinese_clip (${modelPath})`)
      cachedModelType = 'chinese_clip'
      return cachedModelType
    }
    console.log(`[CLIP] 检测到模型架构: ${modelType || 'clip'} (${modelPath})`)
    cachedModelType = 'clip'
    return cachedModelType
  } catch {
    console.log(`[CLIP] 无法读取 config.json，默认使用 clip 架构: ${modelPath}`)
    cachedModelType = 'clip'
    return cachedModelType
  }
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
  const localPath = getModelLocalPath(modelName);
  if (localPath) {
    console.log(`[CLIP] 使用本地模型: ${localPath}`);
    try {
      return await loadFn(localPath);
    } catch (error) {
      console.warn(`[CLIP] 本地模型加载失败，尝试重新下载:`, error);
    }
  }

  const isHfReachable = await probeHuggingFaceReachability();

  if (!isHfReachable) {
    console.log(`[CLIP] HuggingFace 不可达，直接使用 ModelScope 镜像`);
    const modelScopePath = await downloadFromModelScope(modelName);
    console.log(`[CLIP] 从 ModelScope 加载${modelType}: ${modelScopePath}`);
    return await loadFn(modelScopePath);
  }

  try {
    console.log(`[CLIP] 尝试从 HuggingFace 加载${modelType}`);
    isUsingModelScope = false;
    return await loadFn(modelName);
  } catch (error) {
    if (!isNetworkError(error as Error)) {
      throw error;
    }
    console.warn(`[CLIP] 从 HuggingFace 加载${modelType}失败，准备使用 ModelScope`);
  }

  const modelScopePath = await downloadFromModelScope(modelName);
  console.log(`[CLIP] 从 ModelScope 加载${modelType}: ${modelScopePath}`);
  return await loadFn(modelScopePath);
}

async function getImageExtractor() {
  if (imageModelError) {
    throw new Error(`模型加载失败: ${imageModelError.message}`)
  }

  if (!imageExtractorPromise) {
    const modelName = getEmbeddingModelName();
    console.log(`[CLIP] 正在加载图像特征提取模型: ${modelName}`);
    console.log(`[CLIP] 模型缓存目录: ${MODEL_CACHE_DIR}`);

    imageExtractorPromise = loadModelWithFallback(
      modelName,
      async (modelPath) => {
        const isLocalPath = modelPath.includes('/') && fs.existsSync(modelPath)
        console.log(`[CLIP] 加载图像模型，路径: ${modelPath}, 本地模式: ${isLocalPath}`)

        const modelDir = getModelLocalPath(modelName) || modelName
        const onnxFiles = findOnnxFiles(modelDir)
        let actualDtype = getEmbeddingDtype()
        if (onnxFiles.length > 0) {
          try {
            const quantizedPath = await quantizeModelIfNeeded(onnxFiles[0])
            if (quantizedPath !== onnxFiles[0]) {
              console.log(`[CLIP] 量化模型已就绪: ${quantizedPath}`)
            }
          } catch (e) {
            console.warn(`[CLIP] 预量化失败，将使用 fp32:`, e)
            actualDtype = 'fp32' as DataType
          }
        }

        const extractor = await pipeline('image-feature-extraction', modelPath, {
          cache_dir: MODEL_CACHE_DIR,
          local_files_only: isLocalPath,
          dtype: actualDtype,
        })
        actualDtypeUsed = actualDtype
        return extractor as ExtractorFunc
      },
      '图像特征提取模型'
    )
      .then((extractor) => {
        console.log(`[CLIP] 图像特征提取模型加载成功`);
        imageModelError = null;
        return extractor;
      })
      .catch((error) => {
        console.error(`[CLIP] 图像特征提取模型加载失败:`, error);
        imageModelError = error;
        imageExtractorPromise = null;

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
  if (textModelError) {
    throw new Error(`文本模型加载失败: ${textModelError.message}`)
  }

  if (!textModelPromise) {
    const modelName = getEmbeddingModelName()
    console.log(`[CLIP] 正在加载文本模型: ${modelName}`)

    textModelPromise = loadModelWithFallback(
      modelName,
      async (modelPath) => {
        const isLocalPath = modelPath.includes('/') && fs.existsSync(modelPath)
        console.log(`[CLIP] 加载文本模型，路径: ${modelPath}, 本地模式: ${isLocalPath}`)
        const modelType = await detectModelType(modelPath)
        if (modelType === 'chinese_clip') {
          console.log(`[CLIP] 使用 ChineseCLIPModel 加载文本编码器`)
          return await ChineseCLIPModel.from_pretrained(modelPath, {
            cache_dir: MODEL_CACHE_DIR,
            local_files_only: isLocalPath,
            dtype: getEmbeddingDtype(),
          })
        }
        return await CLIPTextModelWithProjection.from_pretrained(modelPath, {
          cache_dir: MODEL_CACHE_DIR,
          local_files_only: isLocalPath,
        })
      },
      '文本模型'
    )
      .then((model) => {
        console.log(`[CLIP] 文本模型加载成功`)
        textModelError = null
        return model
      })
      .catch((error) => {
        console.error(`[CLIP] 文本模型加载失败:`, error)
        textModelError = error
        textModelPromise = null
        throw error
      })
  }
  return textModelPromise
}

async function getTextTokenizer() {
  if (textTokenizerError) {
    throw new Error(`分词器加载失败: ${textTokenizerError.message}`)
  }

  if (!textTokenizerPromise) {
    const modelName = getEmbeddingModelName()
    console.log(`[CLIP] 正在加载文本分词器: ${modelName}`)

    textTokenizerPromise = loadModelWithFallback(
      modelName,
      async (modelPath) => {
        const isLocalPath = modelPath.includes('/') && fs.existsSync(modelPath)
        console.log(`[CLIP] 加载分词器，路径: ${modelPath}, 本地模式: ${isLocalPath}`)
        const modelType = await detectModelType(modelPath)
        if (modelType === 'chinese_clip') {
          console.log(`[CLIP] 使用 AutoTokenizer 加载 ChineseCLIP 分词器`)
          return await AutoTokenizer.from_pretrained(modelPath, {
            cache_dir: MODEL_CACHE_DIR,
            local_files_only: isLocalPath,
          })
        }
        return await CLIPTokenizer.from_pretrained(modelPath, {
          cache_dir: MODEL_CACHE_DIR,
          local_files_only: isLocalPath,
        })
      },
      '文本分词器'
    )
      .then((tokenizer) => {
        console.log(`[CLIP] 文本分词器加载成功`)
        textTokenizerError = null
        return tokenizer
      })
      .catch((error) => {
        console.error(`[CLIP] 文本分词器加载失败:`, error)
        textTokenizerError = error
        textTokenizerPromise = null
        throw error
      })
  }
  return textTokenizerPromise
}

export async function generateImageEmbedding(imageBuffer: Buffer) {
  if (!imageBuffer || imageBuffer.byteLength === 0) {
    throw new Error('图片内容为空，无法生成向量')
  }

  const startTime = Date.now()
  const extractor = await getImageExtractor()
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

    const vector = normalizeVector(Array.from(vectorData))
    const expectedSize = getEmbeddingVectorSize()
    if (vector.length !== expectedSize) {
      throw new Error(`向量维度异常: expected=${expectedSize}, actual=${vector.length}`)
    }

    const elapsed = Date.now() - startTime
    console.log(`[CLIP] 图像嵌入生成完成，耗时: ${elapsed}ms`)
    return vector
  } finally {
    await fs.promises.unlink(tmpPath).catch((err) => { console.debug({ err, path: tmpPath }, 'Failed to delete temp file') });
  }
}

export async function generateTextEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('文本内容为空，无法生成向量')
  }

  const startTime = Date.now()
  const model = await getTextModel()
  const tokenizer = await getTextTokenizer();

  const outputs = await model.forward(tokenizer(text));

  const modelName = getEmbeddingModelName()
  const modelType = await detectModelType(modelName)

  let vectorData: ArrayLike<number> | undefined

  if (modelType === 'chinese_clip') {
    vectorData = outputs.text_embeds?.data
    if (!vectorData) {
      const hiddenState = outputs.last_hidden_state?.data
      if (hiddenState) {
        const expectedSize = getEmbeddingVectorSize()
        const seqLen = outputs.last_hidden_state.dims[1]
        const hiddenDim = outputs.last_hidden_state.dims[2]
        if (hiddenDim === expectedSize && seqLen > 0) {
          const clsEmbedding = Array.from(hiddenState).slice(0, hiddenDim)
          vectorData = clsEmbedding as unknown as ArrayLike<number>
        }
      }
    }
    if (!vectorData) {
      console.error(`[CLIP] ChineseCLIP 模型输出缺少 text_embeds 和 last_hidden_state, 可用字段: ${Object.keys(outputs).join(', ')}`)
      throw new Error('ChineseCLIP 模型输出缺少 text_embeds 和 last_hidden_state 字段，无法提取文本向量')
    }
  } else {
    vectorData = outputs.text_embeds?.data
    if (!vectorData) {
      console.error(`[CLIP] CLIP 模型输出缺少 text_embeds, 可用字段: ${Object.keys(outputs).join(', ')}`)
      throw new Error('CLIP 模型输出缺少 text_embeds 字段，无法提取文本向量')
    }
  }

  const vector = normalizeVector(Array.from(vectorData))
  const expectedSize = getEmbeddingVectorSize()
  if (vector.length !== expectedSize) {
    throw new Error(`向量维度异常: expected=${expectedSize}, actual=${vector.length}`)
  }

  const elapsed = Date.now() - startTime
  console.log(`[CLIP] 文本嵌入生成完成，耗时: ${elapsed}ms`)
  return vector
}

export async function warmup(): Promise<void> {
  try {
    const extractor = await getImageExtractor();
    const tmpPath = path.join(os.tmpdir(), `_warmup_${Date.now()}.tmp`);
    await fs.promises.writeFile(tmpPath, Buffer.from([255, 0, 0, 255]));
    const dummyImage = await RawImage.read(tmpPath);
    await extractor(dummyImage, { pooling: 'mean', normalize: true });
    await fs.promises.unlink(tmpPath).catch((err) => { console.debug({ err, path: tmpPath }, 'Failed to delete temp file') });
  } catch (error) {
    // warmup failure is non-fatal, first real request will load model
  }
}
