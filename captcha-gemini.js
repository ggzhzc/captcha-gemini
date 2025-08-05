// --- 内部固定配置区域 ---
const CONFIG = {
  // ★★★ 核心修正：更新为更智能的 AI 指令 ★★★
  PROMPT_TEXT: "Analyze this captcha image. If it contains a mathematical expression, solve it and respond with only the numerical result. If it contains a string of characters, respond with only that string. Do not include any explanation.",

  GENERATION_CONFIG: {
    "temperature": 0.1,
    "maxOutputTokens": 20,
  }
};

export default {
  async fetch(request, env, ctx) {
    // 1. 从 Worker 的环境变量和机密中读取外部配置
    const externalConfig = {
      geminiApiKey: env.GEMINI_API_KEY,
      geminiModel: env.GEMINI_MODEL,
      authToken: env.AUTH_TOKEN,
      apiKey: env.API_KEY,
      kv: env.RESULTS_KV
    };

    // 2. 检查所有必要的外部配置是否存在
    for (const key in externalConfig) {
      if (!externalConfig[key]) {
        return new Response(`Required setting "${key}" is not configured in Worker environment.`, { status: 500 });
      }
    }
    
    // 3. 根据请求路径，判断是“提交任务”还是“获取结果”
    const url = new URL(request.url);
    if (url.pathname === '/submit') {
      return handleSubmit(request, externalConfig, ctx);
    }
    if (url.pathname === '/result') {
      return handleResult(request, externalConfig, ctx);
    }
    return new Response('Not Found. Use /submit or /result endpoints.', { status: 404 });
  }
};

// --- 处理图片提交请求 ---
async function handleSubmit(request, config, ctx) {
  if (request.method !== 'POST') return new Response('Expected POST', { status: 405 });

  const clientAuthToken = request.headers.get('Authorization');
  if (clientAuthToken !== `Bearer ${config.authToken}`) {
    return new Response('Unauthorized: Invalid AUTH_TOKEN', { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch (e) { return new Response('Invalid JSON body', { status: 400 }); }
  if (!body.image) { return new Response('Missing "image" field', { status: 400 }); }

  const taskId = crypto.randomUUID();
  await config.kv.put(taskId, JSON.stringify({ status: 'pending' }), { expirationTtl: 300 });

  ctx.waitUntil(solveAndStore(taskId, body.image, config));

  return new Response(JSON.stringify({ taskId: taskId }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- 处理结果查询请求 ---
async function handleResult(request, config, ctx) {
  if (request.method !== 'GET') return new Response('Expected GET', { status: 405 });
  
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');
  const clientApiKey = url.searchParams.get('apiKey');

  if (clientApiKey !== config.apiKey) {
    return new Response('Unauthorized: Invalid API_KEY', { status: 401 });
  }
  if (!taskId) {
    return new Response('Missing "taskId" query parameter', { status: 400 });
  }

  const result = await config.kv.get(taskId);
  if (result === null) {
    return new Response('Task not found or expired', { status: 404 });
  }
  
  return new Response(result, { headers: { 'Content-Type': 'application/json' } });
}

// --- 在后台运行的 AI 识别与存储任务 ---
async function solveAndStore(taskId, imageBase64, config) {
  // 使用代码中定义的内部配置
  const geminiPayload = {
    "contents": [{"parts": [{ "text": CONFIG.PROMPT_TEXT }, { "inline_data": { "mime_type": "image/png", "data": imageBase64 } }]}],
    "generationConfig": CONFIG.GENERATION_CONFIG
  };

  const geminiResult = await callGemini(config.geminiApiKey, config.geminiModel, geminiPayload);

  let finalResult;
  if (geminiResult.error) {
    finalResult = { status: 'error', message: geminiResult.error };
  } else {
    finalResult = { status: 'completed', solution: geminiResult.solution };
  }
  
  await config.kv.put(taskId, JSON.stringify(finalResult), { expirationTtl: 300 });
}

// --- 通用的 Gemini API 调用函数 ---
async function callGemini(apiKey, model, payload) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) { const errorText = await response.text(); return { error: `Gemini API error: ${errorText}` }; }
  const result = await response.json();
  try { const solution = result.candidates[0].content.parts[0].text.trim(); return { solution: solution }; }
  catch (e) { return { error: 'Failed to parse Gemini response' }; }
}
