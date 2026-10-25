/**
 * 即時檢查抽屜 catalog（繁體中文，臺灣）. Same keys and placeholders as en.ts. Glossary as in ../../i18n/zh-TW.ts
 * (05 §10): 詞元 · 位元組 · 分詞器; fullwidth punctuation（「」，。）.
 */
import type { ByokCatalog } from './en.ts';

export const byokZhTW = {
  'byok.warning':
    '金鑰只會留在這個分頁的記憶體中，只透過 HTTPS 傳給服務供應商，重新載入後就會被忘記。本網站沒有後端，也沒有分析追蹤。',
  'byok.key': 'API 金鑰',
  'byok.forget': '忘記金鑰',
  'byok.forgotten': '已忘記金鑰',
  'byok.model': '模型',
  'byok.pending': '正在等待 {host} 回應…',
  'byok.textEmpty': '請先輸入文字。',
  'byok.stale': '這次回應之後文字已變更，請針對新的文字再檢查一次。',

  'byok.anthropic.heading': 'Anthropic 詞元計數（Claude 3 以後）',
  'byok.anthropic.intro': '用 Anthropic 的 count_tokens 端點計算你的文字。API 只回傳總數，不提供詞元邊界。',
  'byok.anthropic.auth': '金鑰傳送方式',
  'byok.anthropic.auth.bearer': 'Authorization: Bearer（預設）',
  'byok.anthropic.auth.xApiKey': 'x-api-key 標頭',
  'byok.anthropic.modelOption': '{model}（≈ {n} 個框架詞元）',
  'byok.anthropic.workspace': '工作區 ID（選填）',
  'byok.anthropic.workspaceHint': '金鑰未限定於單一工作區時需要填寫。',
  'byok.anthropic.run': '計算詞元',
  'byok.anthropic.result':
    'API 總數 {total}（含 ≈ {frame} 個框架詞元 → ≈ {content} 個內容詞元），舊版詞彙計數為 {legacy}；無法取得詞元邊界',
  'byok.anthropic.resultAlone':
    'API 總數 {total}（含 ≈ {frame} 個框架詞元 → ≈ {content} 個內容詞元）；無法取得詞元邊界',
  'byok.anthropic.compare': '顯示舊版詞彙的計數',

  'byok.xai.heading': 'xAI 分詞（Grok 4.x）',
  'byok.xai.intro': '用 xAI 的 tokenize-text 端點為你的文字分詞，並把真實的詞元位元組對齊在 Grok-2 詞元下方。',
  'byok.xai.run': '分詞',
  'byok.xai.count': '{model}：{n} 個詞元',
  'byok.xai.matches': '在這段文字上與 Grok-2 一致 ✓',
  'byok.xai.differ': '{n} 個邊界中有 {k} 個與 Grok-2 不同（在即時詞元層以斜線標示）',
  'byok.xai.unaligned': '無法將 API 詞元對齊到你的文字（{total} 個位元組中有 {matched} 個相符）',
  'byok.xai.compare': '選擇 Grok-2 以比較',

  'byok.tokens': 'API 回傳的詞元',
  'byok.tokens.unaligned': 'API 回傳的詞元（依序列出，未對齊到你的文字）',
  'byok.tokens.more': '……還有 {n} 個',
  'byok.token.differs': '邊界不同',
  'byok.token.partial': '部分',
  'byok.token.zeroWidth': '0 位元組',
  'byok.token.noBytes': '沒有位元組',

  'byok.error.key': '服務供應商拒絕了這個 API 金鑰（HTTP {status}）。請檢查金鑰後再試一次。',
  'byok.error.workspace': 'Anthropic 需要這個金鑰的工作區 ID（HTTP {status}）。請填入工作區 ID 後再試一次。',
  'byok.error.model': '服務供應商拒絕了這個模型的請求（HTTP {status}）。請檢查模型。',
  'byok.error.request': '服務供應商拒絕了這個請求（HTTP {status}）。',
  'byok.error.rateLimit': '已達速率限制（HTTP {status}）。請稍候再試。',
  'byok.error.server': '服務供應商發生問題（HTTP {status}）。請稍後再試。',
  'byok.error.zdr': '無法從這個頁面連線到 Anthropic（網路或 CORS）。零資料保留（ZDR）組織無法從瀏覽器呼叫這個端點。',
  'byok.error.network': '無法從這個頁面連線到 {host}（網路或 CORS）。',
  'byok.error.timeout': '{n} 秒內沒有回應。請再試一次。',
  'byok.error.badResponse': '服務供應商的回應格式不符預期。',
  'byok.error.detail': '{provider} 的訊息：「{detail}」',
} as const satisfies ByokCatalog;
