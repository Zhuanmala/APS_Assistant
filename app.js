/* ── Login Gate ── */
(function initLogin() {
  const PASS_HASH = "4c6052712ab570a88c03e2298528d705d6382224d9d4ccdd75c5c96a7fbc4cbf";
  const SESSION_KEY = "aps_logged_in";

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function showApp() {
    document.getElementById("loginGate").style.display = "none";
    document.getElementById("appContent").style.display = "";
  }

  if (sessionStorage.getItem(SESSION_KEY) === "1") {
    showApp();
  }

  document.getElementById("loginBtn").addEventListener("click", async () => {
    const pwd = document.getElementById("loginPassword").value;
    const hash = await sha256(pwd);
    if (hash === PASS_HASH) {
      sessionStorage.setItem(SESSION_KEY, "1");
      showApp();
    } else {
      document.getElementById("loginError").style.display = "";
    }
  });

  document.getElementById("loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("loginBtn").click();
  });
})();

const state = {
  diagnosis: null,
  currentSessionId: null,
  llm: {
    provider: "gemini",
    enabled: false,
    apiKey: "",
    model: "gemini-2.5-flash",
    lastStatus: "未配置",
  },
  interview: {
    started: false,
    current: 0,
    currentRetry: 0,
    total: 10,
    score: 0,
    history: [],
    dimensionScores: {
      course: [],
      understanding: [],
      application: [],
      expression: [],
    },
    language: "zh-en",
    major: "engineering",
    subjects: [],
    voice: {
      supported: false,
      listening: false,
      lastTranscript: "",
    },
  },
  radar: {
    docs: [],
    missingCritical: [],
    missingNormal: [],
  },
};

const STORAGE_KEY = "aps_mvp_records";
const GEMINI_KEY_STORAGE = "aps_gemini_api_key";
const GEMINI_MODEL_STORAGE = "aps_gemini_model";

const speechStatusEl = document.getElementById("speechStatus");
const answerInputEl = document.getElementById("answerInput");
const questionTextEl = document.getElementById("questionText");

const SUBJECT_LIBRARY = {
  engineering: [
    "高等数学",
    "线性代数",
    "概率论与数理统计",
    "大学物理",
    "材料力学",
    "理论力学",
    "机械设计基础",
    "工程制图",
    "控制工程基础",
    "电路原理",
  ],
  cs: [
    "程序设计基础",
    "数据结构",
    "操作系统",
    "计算机组成原理",
    "计算机网络",
    "数据库系统",
    "软件工程",
    "编译原理",
    "算法设计与分析",
    "人工智能导论",
  ],
  business: [
    "微观经济学",
    "宏观经济学",
    "管理学",
    "市场营销",
    "财务管理",
    "会计学",
    "统计学",
    "组织行为学",
    "战略管理",
    "国际贸易",
  ],
  social: [
    "社会学概论",
    "社会研究方法",
    "社会统计学",
    "政治学原理",
    "传播学概论",
    "心理学导论",
    "社会心理学",
    "公共政策分析",
    "中国近现代史",
    "西方思想史",
  ],
  design: [
    "设计素描",
    "色彩构成",
    "平面构成",
    "立体构成",
    "设计史",
    "视觉传达设计",
    "版式设计",
    "字体设计",
    "用户体验设计",
    "交互设计基础",
    "产品设计方法",
    "设计调研与用户访谈",
  ],
};

const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function updateSpeechStatus(message) {
  if (speechStatusEl) {
    speechStatusEl.textContent = `语音状态：${message}`;
  }
}

function updateGeminiStatus(message) {
  state.llm.lastStatus = message;
}

function renderSubjectOptions(major, keepSelected = true) {
  const container = document.getElementById("subjectChecklist");
  if (!container) return;

  const previous =
    keepSelected
      ? new Set(Array.from(container.querySelectorAll("input[type='checkbox']:checked")).map((i) => i.value))
      : new Set();
  const options = SUBJECT_LIBRARY[major] || SUBJECT_LIBRARY.engineering;

  container.innerHTML = options
    .map(
      (subject, index) => `
      <label for="subject_${index}">
        <input id="subject_${index}" type="checkbox" value="${subject}" ${previous.has(subject) ? "checked" : ""} />
        <span>${subject}</span>
      </label>
    `
    )
    .join("");
}

function getSelectedSubjects() {
  const container = document.getElementById("subjectChecklist");
  if (!container) return [];
  return Array.from(container.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value);
}

function restoreGeminiConfig() {
  const savedKey = localStorage.getItem("aps_gemini_api_key") || "";
  state.llm.apiKey = savedKey;
  state.llm.enabled = Boolean(savedKey);
  const keyInput = document.getElementById("geminiApiKey");
  if (keyInput) keyInput.value = savedKey;
}

function saveGeminiConfig() {
  const keyInput = document.getElementById("geminiApiKey");
  const apiKey = keyInput ? keyInput.value.trim() : state.llm.apiKey;
  state.llm.apiKey = apiKey;
  state.llm.enabled = Boolean(apiKey);
  if (apiKey) {
    localStorage.setItem("aps_gemini_api_key", apiKey);
  } else {
    localStorage.removeItem("aps_gemini_api_key");
  }
}

async function callGemini(prompt) {
  if (!state.llm.enabled || !state.llm.apiKey) {
    throw new Error("Gemini API Key 未配置");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${state.llm.model}:generateContent?key=${encodeURIComponent(
    state.llm.apiKey
  )}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini请求失败: ${response.status} ${detail}`);
  }

  const data = await response.json();

  /* Gemini 2.5-pro 使用 thinking 模式，parts 中可能有多个条目：
     [{ thought: true, text: "..." }, { text: "实际回答" }]
     需要取最后一个非 thought 的 part，或者退而取最后一个 part */
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let text = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]?.text && !parts[i]?.thought) {
      text = parts[i].text;
      break;
    }
  }
  if (!text) {
    // fallback: 取最后一个有 text 的 part（即使是 thought）
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i]?.text) {
        text = parts[i].text;
        break;
      }
    }
  }

  if (!text) {
    // 详细诊断信息
    const blocked = data?.promptFeedback?.blockReason;
    const finishReason = data?.candidates?.[0]?.finishReason;
    const diag = blocked
      ? `被安全策略拦截: ${blocked}`
      : finishReason
      ? `finishReason: ${finishReason}, parts数量: ${parts.length}`
      : `响应结构异常: ${JSON.stringify(data).slice(0, 200)}`;
    throw new Error(`Gemini返回为空 (${diag})`);
  }
  return text;
}

async function fetchAvailableGeminiModels() {
  if (!state.llm.apiKey) return [];
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(state.llm.apiKey)}`;
  const response = await fetch(endpoint, { method: "GET" });
  if (!response.ok) return [];
  const data = await response.json();
  const models = Array.isArray(data?.models) ? data.models : [];

  return models
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => (m.name || "").replace(/^models\//, ""))
    .filter(Boolean);
}

/* 模型优先级：越靠前越优先 */
const MODEL_PREFERENCE = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
];

async function autoSelectBestModel() {
  if (!state.llm.apiKey) return;

  const statusEl = document.getElementById("modelStatus");
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  setStatus("正在检测可用模型...");

  const available = await fetchAvailableGeminiModels();
  if (!available.length) {
    setStatus("无法获取模型列表，将使用默认模型");
    return;
  }

  /* 按优先级匹配 */
  let bestModel = "";
  for (const preferred of MODEL_PREFERENCE) {
    if (available.includes(preferred)) {
      bestModel = preferred;
      break;
    }
  }

  /* 如果优先列表都不在，取 available 中包含 gemini 的第一个 */
  if (!bestModel) {
    bestModel = available.find((m) => m.includes("gemini")) || available[0];
  }

  if (bestModel) {
    state.llm.model = bestModel;
    localStorage.setItem("aps_gemini_model", bestModel);
    setStatus(`已自动选择：${bestModel}`);
  } else {
    setStatus("未找到可用模型");
  }
}

async function callGeminiWithFallback(prompt) {
  try {
    return await callGemini(prompt);
  } catch (error) {
    const msg = String(error?.message || "");
    if (!/404|NOT_FOUND|no longer available|INVALID_ARGUMENT/i.test(msg)) {
      throw error;
    }

    /* 当前模型不可用，自动切换到最佳可用模型并重试一次 */
    const statusEl = document.getElementById("modelStatus");
    if (statusEl) statusEl.textContent = `${state.llm.model} 不可用，正在自动切换...`;

    await autoSelectBestModel();

    /* 如果切换后模型变了，重试一次 */
    try {
      return await callGemini(prompt);
    } catch (retryError) {
      throw new Error(`模型自动切换后仍然失败：${retryError.message}`);
    }
  }
}

function parseJsonObjectFromText(text) {
  if (!text) return null;

  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
    }
  }

  const objectMatches = text.match(/\{[\s\S]*?\}/g) || [];
  for (const snippet of objectMatches) {
    try {
      return JSON.parse(snippet);
    } catch {
    }
  }

  return null;
}

function normalizeQuestionText(rawText) {
  if (!rawText) return "";
  return String(rawText)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*(题目|问题|question)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferDimensionFromText(text = "") {
  const t = text.toLowerCase();
  if (/课程|module|course|vorlesung/.test(t)) return "course";
  if (/应用|实践|实验|project|debug|implement/.test(t)) return "application";
  if (/理论|公式|原理|theory|concept/.test(t)) return "understanding";
  return "expression";
}

async function getGeminiInitialQuestion() {
  const promptJson = `你是APS面谈考官。请生成第1题，输出严格JSON：
{
  "question": "...",
  "dimension": "course|understanding|application|expression"
}
要求：
1) 与专业方向 ${state.interview.major} 强相关；
2) 必须优先围绕以下已学课程提问：${state.interview.subjects.join("、")}；
2) 贴近APS真实性核验场景；
3) 问题必须可追问、可验证，不要空泛。`;

  const promptText = `你是APS面谈考官。请只输出一道首题，不要解释。
专业方向：${state.interview.major}
已学课程：${state.interview.subjects.join("、")}
要求：题目要能核验课程真实性，且可追问。`;

  const attempts = [promptJson, promptJson, promptText];
  let lastRaw = "";

  for (let index = 0; index < attempts.length; index += 1) {
    const raw = await callGeminiWithFallback(attempts[index]);
    lastRaw = raw;

    const parsed = parseJsonObjectFromText(raw);
    if (parsed?.question) {
      const question = normalizeQuestionText(parsed.question);
      if (question.length >= 8) {
        return {
          text: question,
          dimension: ["course", "understanding", "application", "expression"].includes(parsed.dimension)
            ? parsed.dimension
            : inferDimensionFromText(question),
          keywords: [],
        };
      }
    }

    const plain = normalizeQuestionText(raw);
    if (plain.length >= 8) {
      return {
        text: plain,
        dimension: inferDimensionFromText(plain),
        keywords: [],
      };
    }
  }

  throw new Error(`首题解析失败，模型返回不可识别。raw=${lastRaw.slice(0, 120)}`);
}

async function getGeminiCoach(question, answer, localResult) {
  const prompt = `你是APS面谈教练。请严格输出JSON，不要输出markdown。
字段要求：
{
  "accept": boolean,
  "relevance": 0-100整数,
  "score": 0-100整数,
  "issues": ["..."],
  "nextQuestion": "...",
  "nextDimension": "course|understanding|application|expression",
  "improvedAnswer": "...",
  "tips": ["..."]
}

题目：${question.text}
学生回答：${answer}
学生已学课程：${state.interview.subjects.join("、")}

判定标准：
1) 若明显跑题、空话、与课程真实性无关，则accept=false。
2) improvedAnswer必须是可直接模仿的更好回答，且更具体。
3) nextQuestion必须是下一道考官追问，且针对当前回答缺陷。
4) 输出语言使用中文。`;

  const raw = await callGemini(prompt);
  const parsed = parseJsonObjectFromText(raw);
  if (!parsed) {
    throw new Error("Gemini结果无法解析为JSON");
  }
  return parsed;
}

async function testGeminiConnection() {
  try {
    saveGeminiConfig();
    updateGeminiStatus(`测试中（锁定模型：${state.llm.model}）...`);
    const raw = await callGeminiWithFallback("请只回复：OK");
    updateGeminiStatus(`连通成功（${state.llm.model}）: ${raw.slice(0, 30)}`);
  } catch (error) {
    updateGeminiStatus(`连通失败：${error.message}`);
  }
}

function getStoredRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function appendStoredRecord(record) {
  const records = getStoredRecords();
  records.push(record);
  const trimmed = records.slice(-300);
  saveStoredRecords(trimmed);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderLiveRecords() {
  const target = document.getElementById("liveRecords");
  if (!target) return;

  const sessionId = state.currentSessionId;
  const records = sessionId
    ? getStoredRecords().filter((r) => r.sessionId === sessionId)
    : [];

  if (!records.length) {
    target.textContent = "暂无记录";
    return;
  }

  target.innerHTML = records
    .map(
      (item) => `
      <div class="record-item">
        <b>第${item.questionIndex}题</b>（${item.mode === "voice" ? "语音" : "文本"}，${item.score}分）<br/>
        <span>${escapeHtml(item.answer.slice(0, 140))}${item.answer.length > 140 ? "..." : ""}</span><br/>
        <small>相关性：${item.relevance ?? "-"} ${item.source ? `| 反馈源：${item.source}` : ""}</small>
      </div>
    `
    )
    .join("");
}

function speechLangByInterview() {
  const lang = state.interview.language;
  if (lang === "de") return "de-DE";
  if (lang === "en") return "en-US";
  return "en-US";
}

function initVoiceEngine() {
  if (!SpeechRecognitionApi) {
    state.interview.voice.supported = false;
    updateSpeechStatus("当前浏览器不支持语音识别，请改用Chrome/Edge或手动输入");
    return;
  }

  recognition = new SpeechRecognitionApi();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = speechLangByInterview();

  recognition.onstart = () => {
    state.interview.voice.listening = true;
    updateSpeechStatus("正在录音中...");
  };

  recognition.onend = () => {
    state.interview.voice.listening = false;
    updateSpeechStatus("录音已结束");
  };

  recognition.onerror = (event) => {
    state.interview.voice.listening = false;
    updateSpeechStatus(`识别异常：${event.error}`);
  };

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0].transcript)
      .join(" ")
      .trim();

    state.interview.voice.lastTranscript = transcript;
    if (answerInputEl) {
      answerInputEl.value = transcript;
    }
  };

  state.interview.voice.supported = true;
  updateSpeechStatus("已就绪，可开始语音回答");
}

function readQuestionByVoice() {
  const text = questionTextEl?.textContent?.trim();
  if (!text) return;
  if (!window.speechSynthesis) {
    updateSpeechStatus("当前浏览器不支持语音朗读");
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(`请准备回答。${text}`);
  const targetLang = state.interview.language === "de" ? "de-DE" : state.interview.language === "en" ? "en-US" : "zh-CN";
  utterance.lang = targetLang;
  utterance.rate = 0.92;
  utterance.pitch = 1.02;
  utterance.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((voice) => voice.lang?.toLowerCase().startsWith(targetLang.slice(0, 2).toLowerCase()));
  if (preferred) {
    utterance.voice = preferred;
  }

  window.speechSynthesis.speak(utterance);
}

function startVoiceAnswer() {
  if (!state.interview.voice.supported || !recognition) {
    updateSpeechStatus("无法启动录音，请检查浏览器支持");
    return;
  }
  if (state.interview.voice.listening) return;
  recognition.lang = speechLangByInterview();
  recognition.start();
}

function stopVoiceAnswer() {
  if (!recognition || !state.interview.voice.listening) return;
  recognition.stop();
}

const questionBank = {
  engineering: [
    {
      text: "请用你选择的面谈语言，介绍一门你成绩较好的工科核心课程，并说明你做过的一个实验。",
      dimension: "course",
      keywords: ["课程", "实验", "结果", "误差"],
    },
    {
      text: "解释你在某门课程中遇到的技术问题，你如何定位并解决？",
      dimension: "application",
      keywords: ["问题", "分析", "方案", "验证"],
    },
    {
      text: "请简述一个你熟悉的工程公式或定律，并说明其适用条件。",
      dimension: "understanding",
      keywords: ["条件", "变量", "假设", "限制"],
    },
  ],
  cs: [
    {
      text: "请介绍你学过的一门计算机核心课程，并举一个项目中的实际应用。",
      dimension: "course",
      keywords: ["课程", "项目", "实现", "结果"],
    },
    {
      text: "描述一个你调试过的复杂Bug，包含定位路径与最终修复。",
      dimension: "application",
      keywords: ["复现", "日志", "定位", "修复"],
    },
    {
      text: "请解释你如何比较两种算法的优劣，以及你选择其中一种的依据。",
      dimension: "understanding",
      keywords: ["复杂度", "场景", "权衡", "性能"],
    },
  ],
  business: [
    {
      text: "介绍一门你学过的商科课程，并说出一个你用过的分析框架。",
      dimension: "course",
      keywords: ["课程", "框架", "案例", "结论"],
    },
    {
      text: "选一个企业案例，说明你如何做问题拆解与决策建议。",
      dimension: "application",
      keywords: ["数据", "分析", "建议", "风险"],
    },
    {
      text: "请解释一个你最熟悉的经济或管理理论，并讲清适用边界。",
      dimension: "understanding",
      keywords: ["假设", "边界", "变量", "解释"],
    },
  ],
  social: [
    {
      text: "请介绍你学过的一门人文社科核心课程，并说明你的阅读/研究材料。",
      dimension: "course",
      keywords: ["课程", "文献", "方法", "结论"],
    },
    {
      text: "给出一个社会现象，说明你如何建立分析框架并论证。",
      dimension: "application",
      keywords: ["现象", "框架", "论据", "反例"],
    },
    {
      text: "解释一个你熟悉的理论，并用一个具体案例支持你的观点。",
      dimension: "understanding",
      keywords: ["理论", "案例", "证据", "局限"],
    },
  ],
};

const fallbackQuestions = [
  {
    text: "请准确翻译你成绩单上的3门课程名称，并说明你在其中做了什么。",
    dimension: "expression",
    keywords: ["课程", "内容", "作业", "结果"],
  },
  {
    text: "如果考官说你回答太泛，请你如何用具体例子补充？",
    dimension: "expression",
    keywords: ["具体", "步骤", "例子", "结果"],
  },
  {
    text: "请说明你在某门课中如何从理论走到实践，并给出一条可验证结果。",
    dimension: "application",
    keywords: ["理论", "实践", "验证", "结果"],
  },
];

const stepButtons = document.querySelectorAll(".step");
const stepPanels = {
  1: document.getElementById("step-1"),
  2: document.getElementById("step-2"),
  3: document.getElementById("step-3"),
  4: document.getElementById("step-4"),
};

function switchStep(step) {
  stepButtons.forEach((btn) => btn.classList.toggle("active", Number(btn.dataset.step) === step));
  Object.entries(stepPanels).forEach(([key, panel]) => {
    panel.classList.toggle("hidden", Number(key) !== step);
  });
}

stepButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchStep(Number(btn.dataset.step)));
});

function computeDiagnosis() {
  const status = document.getElementById("status").value;
  const semester = Number(document.getElementById("semester").value || 0);
  const uniType = document.getElementById("uniType").value;
  const educationType = document.getElementById("educationType").value;
  const failedBefore = document.getElementById("failedBefore").value;
  const targetCountry = document.getElementById("targetCountry").value;

  const risks = [];
  let route = "Interview";
  let confidence = "中";

  if (targetCountry !== "germany") {
    risks.push("你选择的不是德国，当前APS规则参考价值会下降。");
  }

  if (educationType === "junior") {
    route = "Interview";
    confidence = "高";
    risks.push("专科背景通常走Interview路径，建议重点准备课程真实性问答。");
  } else if (failedBefore === "yes") {
    route = "Interview";
    confidence = "高";
    risks.push("已有失败记录，通常进入重复面谈逻辑，时间与费用压力更高。");
  } else if (status === "graduated") {
    route = "Interview";
    confidence = "中高";
    risks.push("已毕业申请者常规以Interview为主，需关注课程细节复述能力。");
  } else {
    if (semester <= 6) {
      route = "TestAS优先（可转Interview）";
      confidence = "中高";
      risks.push("注意报名截止日，资料与费用须在截止前到达APS。");
    } else {
      route = "TestAS或Interview（以最新政策与资格判定为准）";
      confidence = "中";
      risks.push("处于最后学年需额外关注声明要求与资格边界条件。");
    }
  }

  if (uniType === "non211" && semester < 3) {
    risks.push("非211且学期较早，可能受资格条件影响，建议保守按Interview准备。");
  }

  risks.push("Interview与TestAS存在不可逆切换规则，决策前务必确认最新官方说明。");
  risks.push("APS明确不要求使用中介，避免额外费用和信息错误责任。");

  return {
    route,
    confidence,
    risks,
    profile: { status, semester, uniType, educationType, failedBefore, targetCountry },
  };
}

document.getElementById("runDiagnosis").addEventListener("click", () => {
  const result = computeDiagnosis();
  state.diagnosis = result;

  const wrapper = document.getElementById("diagnosisResult");
  wrapper.classList.remove("hidden");
  wrapper.innerHTML = `
    <h3>建议路径：${result.route}</h3>
    <p><b>判断置信度：</b>${result.confidence}</p>
    <ul>
      ${result.risks.map((item) => `<li>${item}</li>`).join("")}
    </ul>
    <p class="hint">建议：先完成2轮模拟面谈再决定最终路径。</p>
  `;

  renderDocumentChecklist();
});

function dimensionLabel(dimension) {
  const map = {
    course: "课程真实性",
    understanding: "理论理解",
    application: "实践应用",
    expression: "表达清晰度",
  };
  return map[dimension] || "综合";
}

function buildQuestionQueue() {
  const major = state.interview.major;
  const base = [...(questionBank[major] || questionBank.engineering)];
  const queue = [];
  while (queue.length < state.interview.total) {
    for (const q of base) {
      if (queue.length >= state.interview.total) break;
      queue.push({ ...q });
    }
    for (const q of fallbackQuestions) {
      if (queue.length >= state.interview.total) break;
      queue.push({ ...q });
    }
  }
  return queue.slice(0, state.interview.total);
}

let questionQueue = [];

function getWeakestDimension() {
  const entries = Object.entries(state.interview.dimensionScores).map(([name, scores]) => {
    if (!scores.length) return { name, avg: 100 };
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return { name, avg };
  });
  entries.sort((a, b) => a.avg - b.avg);
  return entries[0]?.name || "expression";
}

function generateFollowUp(dimension) {
  const followups = {
    course: "请从你的成绩单再选1门课，说明课堂内容、作业类型和你最难的一次作业。",
    understanding: "请把刚才的理论换一种更简单的方式解释给大一新生。",
    application: "给出一个你亲自做过的步骤级例子，包含输入、处理、输出。",
    expression: "请用三句话重述你的答案：背景、行动、结果。",
  };
  return {
    text: followups[dimension],
    dimension,
    keywords: ["背景", "步骤", "结果", "具体"],
  };
}

function renderCurrentQuestion() {
  const currentQ = questionQueue[state.interview.current];
  document.getElementById("qProgress").textContent = `第${state.interview.current + 1}/${state.interview.total}题`;
  document.getElementById("qDimension").textContent = dimensionLabel(currentQ.dimension);
  document.getElementById("questionText").textContent = currentQ.text;
  document.getElementById("answerInput").value = "";
  document.getElementById("feedback").classList.add("hidden");
  document.getElementById("coachPanel")?.classList.add("hidden");
  document.getElementById("coachPanel").innerHTML = "";
  state.interview.voice.lastTranscript = "";
  state.interview.currentRetry = 0;
  updateSpeechStatus("待作答");
}

function buildAnswerTemplate(question) {
  return `我回答这道题会按三段：\n1) 课程/主题：我学的是【课程名】, 核心内容是【2个知识点】。\n2) 我的实践：我做过【实验/项目】, 步骤是【步骤1-2-3】。\n3) 结果与反思：结果是【数据/现象】, 我理解其原因是【原因】。\n\n请围绕题目“${question.text}”填空后再说一次。`;
}

function buildSampleAnswer(question, major) {
  const examples = {
    engineering:
      "例如在《材料力学》课程中，我做过梁弯曲实验。先采集载荷与挠度数据，再用公式计算理论值，最后对比误差约5%。误差主要来自夹具松动和读数偏差。",
    cs:
      "例如在《数据结构》课程项目中，我把链表检索优化为哈希索引。先定位瓶颈函数，再替换索引结构，最终查询耗时从120ms降到25ms。",
    business:
      "例如在《管理学》案例分析里，我用SWOT拆解问题，再用财务数据验证假设，最后给出两阶段策略并评估执行风险。",
    social:
      "例如在《社会研究方法》课程中，我用问卷+访谈做三角验证，先提出假设，再编码数据，最后用反例检验结论边界。",
    design:
      "例如在《用户体验设计》课程项目中，我先做用户访谈整理痛点，再画信息架构和低保真原型，经过2轮可用性测试后把关键任务完成时长从90秒降到45秒。",
  };
  return `参考示范：${examples[major] || examples.engineering}（请不要背诵，换成你自己的课程与经历来回答）`;
}

function scoreAnswer(answer, question) {
  const content = answer.trim();
  const len = content.length;
  const lower = content.toLowerCase();

  const genericSignals = ["不知道", "随便", "不清楚", "没学过", "random", "whatever", "idk"];
  const hasGenericSignal = genericSignals.some((signal) => lower.includes(signal));

  const matchedKeywords = question.keywords.filter((kw) => content.includes(kw));
  const relevance = Math.round((matchedKeywords.length / Math.max(question.keywords.length, 1)) * 100);

  const hasStructure = /首先|然后|最后|first|then|finally|zuerst|dann/.test(content);
  const hasCourseContext = /课程|课上|课堂|module|course|seminar|vorlesung/.test(lower);
  const hasAction = /做了|实现|分析|实验|设计|调试|计算|used|built|tested|analysed|implement/.test(lower);
  const hasResult = /结果|提升|降低|误差|结论|result|improved|reduced|outcome|%.*/.test(lower) || /\d/.test(content);

  let score = 0;
  score += Math.min(35, relevance * 0.35);
  if (len >= 90) score += 20;
  else if (len >= 50) score += 14;
  else if (len >= 25) score += 8;
  else score += 2;

  score += hasStructure ? 15 : 5;
  score += hasCourseContext ? 10 : 0;
  score += hasAction ? 10 : 0;
  score += hasResult ? 10 : 0;

  if (hasGenericSignal) score -= 20;
  if (relevance < 30) score -= 15;

  score = Math.max(0, Math.min(Math.round(score), 100));

  const issues = [];
  if (relevance < 40) issues.push("回答与题目关键词匹配度低，存在跑题风险");
  if (!hasCourseContext) issues.push("缺少具体课程/模块背景");
  if (!hasAction) issues.push("缺少你本人做过的动作步骤");
  if (!hasResult) issues.push("缺少结果或可验证信息（数据/现象）");
  if (!hasStructure) issues.push("表达结构松散，建议用“背景-步骤-结果”");

  const coachTips = [
    "先说课程名与学期，再说一个你亲手做过的实验/项目。",
    "至少给出2个步骤词（例如：先...再...最后...）。",
    "补一个结果证据（数字、现象、误差、性能变化都可以）。",
  ];

  return {
    score,
    relevance,
    matchedKeywords,
    issues,
    coachTips,
    template: buildAnswerTemplate(question),
    sample: buildSampleAnswer(question, state.interview.major),
  };
}

function buildCoachPanelHtml(localResult, aiResult, question) {
  const effective = aiResult || localResult;
  const issues = effective.issues?.length ? effective.issues.join("；") : "无";
  const tips = effective.tips?.length ? effective.tips.join(" ") : "请先补充具体课程与亲身步骤。";
  const improvedAnswer = effective.improvedAnswer || buildSampleAnswer(question, state.interview.major);
  const followup = effective.nextQuestion || "请补充你亲自完成的步骤和可验证结果。";

  return `
    <h4>教练纠偏（${aiResult ? "Gemini" : "本地规则"}）</h4>
    <p><b>主要问题：</b>${issues}</p>
    <p><b>重答模板：</b></p>
    <pre>${escapeHtml(localResult.template)}</pre>
    <p><b>优化示例：</b>${escapeHtml(improvedAnswer)}</p>
    <p><b>下一轮追问：</b>${escapeHtml(followup)}</p>
    <p><b>建议动作：</b>${escapeHtml(tips)}</p>
  `;
}

function interviewSummary() {
  const averages = Object.entries(state.interview.dimensionScores).map(([dimension, scores]) => {
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return { dimension, avg };
  });
  averages.sort((a, b) => a.avg - b.avg);
  const weakTop3 = averages.slice(0, 3);
  const totalAvg = Math.round(state.interview.score / state.interview.total);

  return { weakTop3, totalAvg };
}

document.getElementById("startInterview").addEventListener("click", async () => {
  saveGeminiConfig();
  if (!state.llm.enabled) {
    alert("请先输入Gemini API Key再开始模拟。");
    return;
  }

  /* 自动检测并选择最佳模型 */
  await autoSelectBestModel();

  state.interview.language = document.getElementById("interviewLanguage").value;
  state.interview.major = document.getElementById("majorField").value;
  state.interview.subjects = getSelectedSubjects();
  if (!state.interview.subjects.length) {
    alert("请先从下拉菜单选择你上过的核心科目（建议至少3门）。");
    return;
  }

  state.interview.started = true;
  state.interview.current = 0;
  state.interview.currentRetry = 0;
  state.interview.score = 0;
  state.interview.history = [];
  state.interview.dimensionScores = { course: [], understanding: [], application: [], expression: [] };
  state.interview.voice = { supported: false, listening: false, lastTranscript: "" };
  state.currentSessionId = Date.now();

  initVoiceEngine();

  questionQueue = [];
  document.getElementById("interviewBox").classList.remove("hidden");
  document.getElementById("qScore").textContent = "当前得分：0";
  renderLiveRecords();

  try {
    updateGeminiStatus("正在生成首题...");
    const firstQuestion = await getGeminiInitialQuestion();
    questionQueue[0] = firstQuestion;
    updateGeminiStatus(`已连接（${state.llm.model}）`);
    renderCurrentQuestion();
  } catch (error) {
    state.interview.started = false;
    document.getElementById("interviewBox").classList.add("hidden");
    updateGeminiStatus(`首题生成失败：${error.message}`);
    alert(`Gemini首题生成失败：${String(error.message || "未知错误").slice(0, 180)}`);
  }
});

function submitCurrentAnswer(answer, mode = "text") {
  if (!state.interview.started) return;

  const questionIndex = state.interview.current + 1;
  const question = questionQueue[state.interview.current];

  if (!answer.trim()) {
    alert("请先输入回答。");
    return;
  }

  if (!state.llm.enabled) {
    alert("当前为全Gemini模式，请先配置Gemini。");
    return;
  }

  const localTemplate = {
    template: buildAnswerTemplate(question),
    sample: buildSampleAnswer(question, state.interview.major),
  };
  const feedback = document.getElementById("feedback");
  const coachPanel = document.getElementById("coachPanel");
  const finishSubmission = (effectiveResult, source) => {
    const offTopic = effectiveResult.relevance < 35 || effectiveResult.score < 35 || effectiveResult.accept === false;

    appendStoredRecord({
      sessionId: state.currentSessionId,
      createdAt: new Date().toISOString(),
      questionIndex,
      question: question.text,
      answer,
      score: effectiveResult.score,
      mode,
      relevance: effectiveResult.relevance,
      blocked: offTopic && state.interview.currentRetry < 1,
      source,
    });
    renderLiveRecords();

    const levelClass = effectiveResult.score >= 75 ? "ok" : effectiveResult.score >= 55 ? "warn" : "danger";
    feedback.className = `feedback ${levelClass}`;
    feedback.classList.remove("hidden");
    feedback.innerHTML = `
      本题得分：<b>${effectiveResult.score}</b> / 100<br/>
      相关性：<b>${effectiveResult.relevance}</b> / 100<br/>
      ${effectiveResult.issues?.length ? `需改进：${effectiveResult.issues.join("；")}` : "回答与题目较匹配，继续保持。"}
    `;

    coachPanel.classList.remove("hidden");
    coachPanel.innerHTML = buildCoachPanelHtml(localTemplate, effectiveResult, question);

    if (offTopic && state.interview.currentRetry < 1) {
      state.interview.currentRetry += 1;
      updateSpeechStatus("回答偏题，请按模板重答一次");
      alert("本题回答偏题，我先不计入进度。请点击“一键填入作答模板”后重答。");
      return;
    }

    state.interview.score += effectiveResult.score;
    state.interview.history.push({ question, answer, graded: effectiveResult, mode, questionIndex });
    state.interview.dimensionScores[question.dimension].push(effectiveResult.score);
    state.interview.currentRetry = 0;

    document.getElementById("qScore").textContent = `当前得分：${Math.round(
      state.interview.score / (state.interview.current + 1)
    )}`;

    state.interview.current += 1;

    if (state.interview.current >= state.interview.total) {
      setTimeout(() => {
        const summary = interviewSummary();
        alert(`模拟完成！平均分 ${summary.totalAvg}。接下来请到“材料雷达”继续。`);
        switchStep(3);
      }, 200);
      return;
    }

    const nextQuestionText = effectiveResult.nextQuestion || "请继续围绕上一题补充课程真实性细节。";
    const nextDimension = ["course", "understanding", "application", "expression"].includes(effectiveResult.nextDimension)
      ? effectiveResult.nextDimension
      : inferDimensionFromText(nextQuestionText);
    questionQueue[state.interview.current] = {
      text: nextQuestionText,
      dimension: nextDimension,
      keywords: [],
    };

    setTimeout(renderCurrentQuestion, 150);
  };

  updateGeminiStatus("反馈生成中...");
  getGeminiCoach(question, answer, {})
    .then((aiResult) => {
      const normalized = {
        accept: aiResult.accept !== false,
        relevance: Number.isFinite(aiResult.relevance) ? Math.max(0, Math.min(100, aiResult.relevance)) : 0,
        score: Number.isFinite(aiResult.score) ? Math.max(0, Math.min(100, aiResult.score)) : 0,
        issues: Array.isArray(aiResult.issues) ? aiResult.issues : ["Gemini未返回有效问题列表"],
        nextQuestion: aiResult.nextQuestion || "",
        nextDimension: aiResult.nextDimension || "",
        improvedAnswer: aiResult.improvedAnswer || "",
        tips: Array.isArray(aiResult.tips) ? aiResult.tips : ["请按模板补充课程、步骤、结果"],
      };
      updateGeminiStatus(`已连接（${state.llm.model}）`);
      finishSubmission(normalized, "gemini");
    })
    .catch((error) => {
      updateGeminiStatus(`调用失败：${error.message.slice(0, 120)}`);
      alert("Gemini调用失败，本题未计入。请检查网络或Key后重试提交。");
    });
}

document.getElementById("submitAnswer").addEventListener("click", () => {
  const answer = document.getElementById("answerInput").value;
  submitCurrentAnswer(answer, "text");
});

document.getElementById("fillTemplate")?.addEventListener("click", () => {
  if (!state.interview.started) return;
  const question = questionQueue[state.interview.current];
  const template = buildAnswerTemplate(question);
  answerInputEl.value = template;
  updateSpeechStatus("已填入作答模板，请替换成你的真实经历");
});

document.getElementById("majorField")?.addEventListener("change", (event) => {
  renderSubjectOptions(event.target.value, false);
});

document.getElementById("readQuestion")?.addEventListener("click", () => {
  readQuestionByVoice();
});

document.getElementById("startVoice")?.addEventListener("click", () => {
  startVoiceAnswer();
});

document.getElementById("stopVoice")?.addEventListener("click", () => {
  stopVoiceAnswer();
});

document.getElementById("submitVoice")?.addEventListener("click", () => {
  stopVoiceAnswer();
  const answer = document.getElementById("answerInput").value;
  submitCurrentAnswer(answer, "voice");
});

function exportReviewPdf() {
  const diagnosisRoute = state.diagnosis?.route || "未生成";
  const summary = interviewSummary();
  const sessionId = state.currentSessionId;
  const logs = sessionId
    ? getStoredRecords().filter((r) => r.sessionId === sessionId)
    : [];

  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("未检测到PDF库，请联网后刷新页面重试。");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 14;

  const line = (text) => {
    const lines = doc.splitTextToSize(text, 180);
    doc.text(lines, 14, y);
    y += lines.length * 7;
    if (y > 270) {
      doc.addPage();
      y = 14;
    }
  };

  line("APS MVP Review Report");
  line(`Date: ${new Date().toLocaleString()}`);
  line(`Route: ${diagnosisRoute}`);
  line(`Interview Avg: ${summary.totalAvg || 0}`);
  line(`Missing Critical Docs: ${state.radar.missingCritical.length ? state.radar.missingCritical.join(" | ") : "None"}`);
  line("--- Answer Logs ---");

  if (!logs.length) {
    line("No logs in current session.");
  } else {
    logs.forEach((item) => {
      line(`Q${item.questionIndex} [${item.mode}] Score ${item.score}`);
      line(`Question: ${item.question}`);
      line(`Answer: ${item.answer}`);
      line(" ");
    });
  }

  doc.save(`APS_Review_${Date.now()}.pdf`);
}

document.getElementById("exportPdf")?.addEventListener("click", exportReviewPdf);

function renderDocumentChecklist() {
  const container = document.getElementById("docChecklist");
  const diagnosis = state.diagnosis;

  const docs = [
    { id: "reg_pdf", title: "APS注册确认单（打印）", critical: true },
    { id: "photo", title: "近期证件照", critical: true },
    { id: "payment", title: "缴费凭证", critical: true },
    { id: "passport", title: "护照/身份证明", critical: true },
    { id: "transcript", title: "成绩单与课程清单", critical: true },
    { id: "degree", title: "在读/毕业证明", critical: true },
    { id: "language", title: "语言证明（若有）", critical: false },
  ];

  if (diagnosis?.route.includes("TestAS")) {
    docs.push({ id: "testas_ack", title: "TestAS相关确认与时间表核对", critical: true });
  }
  if (diagnosis?.profile?.semester >= 7 && diagnosis?.route.includes("TestAS")) {
    docs.push({ id: "last_year_statement", title: "最后学年额外声明材料（若适用）", critical: false });
  }
  if (diagnosis?.profile?.failedBefore === "yes") {
    docs.push({ id: "retry_form", title: "重复面谈申请表", critical: true });
  }

  state.radar.docs = docs;

  container.innerHTML = docs
    .map(
      (doc) => `
      <label class="doc-item">
        <div>
          <div>${doc.title}</div>
          <small>${doc.critical ? "关键材料" : "建议材料"}</small>
        </div>
        <input type="checkbox" data-doc-id="${doc.id}" data-critical="${doc.critical}" />
      </label>
    `
    )
    .join("");
}

document.getElementById("runRadar").addEventListener("click", () => {
  if (!state.radar.docs.length) {
    alert("请先在第1步完成路径诊断。");
    switchStep(1);
    return;
  }

  const checked = Array.from(document.querySelectorAll("#docChecklist input[type='checkbox']"))
    .filter((input) => input.checked)
    .map((input) => ({
      id: input.dataset.docId,
      critical: input.dataset.critical === "true",
    }));

  const checkedSet = new Set(checked.map((x) => x.id));
  const missing = state.radar.docs.filter((doc) => !checkedSet.has(doc.id));
  state.radar.missingCritical = missing.filter((doc) => doc.critical).map((doc) => doc.title);
  state.radar.missingNormal = missing.filter((doc) => !doc.critical).map((doc) => doc.title);

  const riskLevel = state.radar.missingCritical.length
    ? "高风险"
    : state.radar.missingNormal.length
    ? "中风险"
    : "低风险";

  const wrapper = document.getElementById("radarResult");
  wrapper.classList.remove("hidden");
  wrapper.innerHTML = `
    <h3>材料风险等级：${riskLevel}</h3>
    <p><b>缺失关键材料：</b>${state.radar.missingCritical.length ? state.radar.missingCritical.join("；") : "无"}</p>
    <p><b>缺失建议材料：</b>${state.radar.missingNormal.length ? state.radar.missingNormal.join("；") : "无"}</p>
  `;

  buildBattleCard();
});

function buildBattleCard() {
  const summary = interviewSummary();
  const weakText = summary.weakTop3
    .map((item) => `${dimensionLabel(item.dimension)}（${item.avg}分）`)
    .join("、");

  const sevenDayPlan = [
    "Day1-2：按成绩单整理8门核心课“课程名-学了什么-做过什么-结果”",
    "Day3：做1轮10题模拟，重点修复最低维度",
    "Day4：把每题答案改成“背景-步骤-结果”三句结构",
    "Day5：补充2个可量化案例（含数字/结果）",
    "Day6：做第二轮模拟，目标平均分≥75",
    "Day7：逐项核对材料清单并确认报名/邮寄时间点",
  ];

  const battle = document.getElementById("battleCard");
  battle.innerHTML = `
    <h3>你的APS作战卡</h3>
    <p><b>推荐路径：</b>${state.diagnosis?.route || "未生成"}</p>
    <p><b>模拟均分：</b>${summary.totalAvg || 0}</p>
    <p><b>薄弱TOP3：</b>${weakText || "请先完成模拟面谈"}</p>
    <p><b>关键材料缺口：</b>${state.radar.missingCritical.length ? state.radar.missingCritical.join("；") : "无"}</p>
    <h4>7天训练计划</h4>
    <ul>${sevenDayPlan.map((d) => `<li>${d}</li>`).join("")}</ul>
    <p class="hint">提示：MVP为训练产品，不替代官方审核结论；请以APS官网最新公告为准。</p>
  `;

  switchStep(4);
}

document.getElementById("resetAll").addEventListener("click", () => {
  stopVoiceAnswer();
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  state.diagnosis = null;
  state.interview = {
    started: false,
    current: 0,
    currentRetry: 0,
    total: 10,
    score: 0,
    history: [],
    dimensionScores: {
      course: [],
      understanding: [],
      application: [],
      expression: [],
    },
    language: "zh-en",
    major: "engineering",
    subjects: [],
    voice: {
      supported: false,
      listening: false,
      lastTranscript: "",
    },
  };
  state.radar = { docs: [], missingCritical: [], missingNormal: [] };

  document.getElementById("diagnosisResult").classList.add("hidden");
  document.getElementById("diagnosisResult").innerHTML = "";
  document.getElementById("interviewBox").classList.add("hidden");
  document.getElementById("docChecklist").innerHTML = "";
  document.getElementById("radarResult").classList.add("hidden");
  document.getElementById("radarResult").innerHTML = "";
  document.getElementById("battleCard").innerHTML = "";
  const liveRecords = document.getElementById("liveRecords");
  if (liveRecords) {
    liveRecords.textContent = "暂无记录";
  }
  state.currentSessionId = null;
  updateSpeechStatus("未开始（建议使用Chrome/Edge）");

  switchStep(1);
});

restoreGeminiConfig();
renderSubjectOptions(document.getElementById("majorField")?.value || "engineering", false);