/**
 * ライブチェック drawer catalog（日本語）. Same keys and placeholders as en.ts. Glossary as in ../../i18n/ja.ts (05 §10):
 * トークン · バイト · トークナイザー; fullwidth punctuation（「」、。）.
 */
import type { ByokCatalog } from './en.ts';

export const byokJa = {
  'byok.warning':
    'キーはこのタブのメモリーにのみ保持され、HTTPS でプロバイダーにだけ送信され、再読み込みすると消去されます。このサイトにはバックエンドもアクセス解析もありません。',
  'byok.key': 'API キー',
  'byok.forget': 'キーを消去',
  'byok.forgotten': 'キーを消去しました',
  'byok.model': 'モデル',
  'byok.pending': '{host} の応答を待っています…',
  'byok.textEmpty': '先にテキストを入力してください。',
  'byok.stale': 'この応答の後でテキストが変更されました。新しいテキストでもう一度チェックしてください。',

  'byok.anthropic.heading': 'Anthropic トークン数（Claude 3 以降）',
  'byok.anthropic.intro':
    'Anthropic の count_tokens エンドポイントでテキストを数えます。API が返すのは合計だけで、トークンの境界は返しません。',
  'byok.anthropic.auth': 'キーの送信方法',
  'byok.anthropic.auth.bearer': 'Authorization: Bearer（既定）',
  'byok.anthropic.auth.xApiKey': 'x-api-key ヘッダー',
  'byok.anthropic.modelOption': '{model}（≈ {n} フレームトークン）',
  'byok.anthropic.workspace': 'ワークスペース ID（任意）',
  'byok.anthropic.workspaceHint': 'キーが 1 つのワークスペースに限定されていない場合に必要です。',
  'byok.anthropic.run': 'トークンを数える',
  'byok.anthropic.result':
    'API 合計 {total}（≈ {frame} フレームトークンを含む → ≈ {content} コンテンツトークン）、レガシー語彙でのカウントは {legacy}。境界は取得できません',
  'byok.anthropic.resultAlone':
    'API 合計 {total}（≈ {frame} フレームトークンを含む → ≈ {content} コンテンツトークン）。境界は取得できません',
  'byok.anthropic.compare': 'レガシー語彙のカウントを表示',

  'byok.xai.heading': 'xAI トークン化（Grok 4.x）',
  'byok.xai.intro':
    'xAI の tokenize-text エンドポイントでテキストをトークン化し、実際のトークンのバイトを Grok-2 のトークンの下にそろえて表示します。',
  'byok.xai.run': 'トークン化',
  'byok.xai.count': '{model}：{n} トークン',
  'byok.xai.matches': 'このテキストでは Grok-2 と一致 ✓',
  'byok.xai.differ': '{n} 個の境界のうち {k} 個が Grok-2 と異なります（ライブトークン層に斜線で表示）',
  'byok.xai.unaligned': 'API のトークンをテキストにそろえられませんでした（{total} バイト中 {matched} バイトが一致）',
  'byok.xai.compare': 'Grok-2 を選んで比較',

  'byok.tokens': 'API が返したトークン',
  'byok.tokens.unaligned': 'API が返したトークン（順番どおり、テキストにはそろえていません）',
  'byok.tokens.more': '…ほか {n} 個',
  'byok.token.differs': '境界が異なる',
  'byok.token.partial': '部分',
  'byok.token.zeroWidth': '0 バイト',
  'byok.token.noBytes': 'バイトなし',

  'byok.error.key':
    'プロバイダーがこの API キーを拒否しました（HTTP {status}）。キーを確認してもう一度お試しください。',
  'byok.error.workspace':
    'このキーには Anthropic のワークスペース ID が必要です（HTTP {status}）。ワークスペース ID を入力してもう一度お試しください。',
  'byok.error.model':
    'プロバイダーがこのモデルへのリクエストを拒否しました（HTTP {status}）。モデルを確認してください。',
  'byok.error.request': 'プロバイダーがリクエストを拒否しました（HTTP {status}）。',
  'byok.error.rateLimit': 'レート制限に達しました（HTTP {status}）。少し待ってからもう一度お試しください。',
  'byok.error.server': 'プロバイダー側で問題が発生しました（HTTP {status}）。後でもう一度お試しください。',
  'byok.error.zdr':
    'このページから Anthropic に接続できませんでした（ネットワークまたは CORS）。ゼロデータ保持（ZDR）の組織はブラウザーからこのエンドポイントを呼び出せません。',
  'byok.error.network': 'このページから {host} に接続できませんでした（ネットワークまたは CORS）。',
  'byok.error.timeout': '{n} 秒以内に応答がありませんでした。もう一度お試しください。',
  'byok.error.badResponse': 'プロバイダーの応答が想定した形式ではありませんでした。',
  'byok.error.detail': '{provider} のメッセージ：「{detail}」',
} as const satisfies ByokCatalog;
