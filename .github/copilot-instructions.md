Always respond in 日本語

## プロジェクト概要

Rain.js は Cloudflare Workers 上で動作する TypeScript 製の軽量 Web フレームワークです。
ファイルベースルーティングを採用し、`src/routes/` 配下のファイル構造がそのまま URL パスにマッピングされます。

## 技術スタック

- **ランタイム**: Cloudflare Workers
- **言語**: TypeScript（strict モード全有効）
- **リンター/フォーマッター**: Biome
- **開発サーバー**: wrangler dev（`npm run dev` で起動）
- **ビルド**: `scripts/dev.js` がルートファイルを走査し `.rainjs/entry.ts` を自動生成

## 設計理念（絶対優先事項）

以下はフレームワークの憲法であり、仕様に迷った際の判断基準です。

1. **デフォルトでセキュアであること** — XSS、CSRF、SQLインジェクションなどの対策が初期状態で有効であること
2. **開発者体験（DX）を最優先する** — エラーメッセージは「何が起きたか」だけでなく「どう解決すべきか」まで示すこと
3. **徹底した疎結合とモジュール化** — コア機能（ルーティングなど）と周辺機能（ORM、テンプレートエンジンなど）を分離し、将来の入れ替えを容易にすること
4. **テストの書きやすさ** — モック作成が容易で、開発者が自然とユニットテストを書きたくなる設計にすること
5. **パフォーマンスの基準値を死守する** — 許容オーバーヘッドの上限を定義し、それを超えないこと

## プロジェクト構造

```
src/
  framework/            # コアフレームワーク（Rain クラス、ルーティングエンジン、JSX）
  routes/               # ファイルベースルーティング
    layout.tsx          # ルートレイアウト（<html>, <head>, <body>）
    route.ts            # GET / → API ルートパス
    hello/
      page.tsx          # GET /hello → ページ（レイアウト適用）
    user/
      route.ts          # GET /user → API
      [id]/
        route.ts        # GET /user/:id（動的ルート）
scripts/
  dev.js                # ルート自動生成 & wrangler dev 起動スクリプト
.rainjs/
  entry.ts              # 自動生成されるエントリポイント（編集禁止）
docs/                   # ドキュメント
```

## コーディング規約

- **インデント**: スペース 2 つ
- **行幅**: 80 文字
- `.rainjs/` 配下のファイルは自動生成のため**手動で編集しないこと**
- ルートハンドラは `src/routes/` に `route.ts` として配置し、HTTP メソッド名（`GET`, `POST`, `PUT`, `DELETE`）を named export する
- ページは `src/routes/` に `page.tsx` として配置し、default export する（レイアウトが自動適用される）
- レイアウトは `src/routes/` に `layout.tsx` として配置し、default export する
- **同一ディレクトリに `page.tsx` と `route.ts` を共存させてはならない**（ビルドエラー）
- 動的ルートはディレクトリとして表現する（`[param]/route.ts` または `[param]/page.tsx`）
- 型は `import type` を使用する（`verbatimModuleSyntax: true`）
- 未使用の変数・インポートは許可しない
- **コメント禁止** — TypeScript/TSX ソースコード内にコメント（`//` や `/* */`）を記載しないこと。意図は関数名・変数名・型定義で表現する。設定ファイル（tsconfig.json 等）のセクション区切りコメントは許容する

## ルートファイルの書き方

```typescript
import type { Handler } from "../../framework";

export const GET: Handler = (req, params) => {
  return new Response("Hello");
};
```

- `Handler` 型: `(req: Request, params: Record<string, string>) => Response`
- 動的パラメータは `params` から取得する（例: `params["id"]`）
- 1 ファイルに複数の HTTP メソッドを export できる

## ミドルウェアファイルの書き方

`_middleware.ts` をディレクトリに配置すると、そのディレクトリ以下の全ルートにミドルウェアが自動適用される。

```typescript
import type { Middleware } from "../../framework";

export const onRequest: Middleware = async (ctx, next) => {
  const start = Date.now();
  const res = await next();
  console.log(`${ctx.req.method} ${ctx.req.url} - ${Date.now() - start}ms`);
  return res;
};
```

- ミドルウェアファイルは `onRequest` を named export する（必須）
- `Middleware` 型: `(ctx: Context, next: () => Promise<Response>) => Response | Promise<Response>`
- 親ディレクトリから子ディレクトリの順に実行される（Koa スタイルのオニオンモデル）

## ページファイルの書き方

`page.tsx` はレイアウトが自動適用される HTML ページ用ファイル。default export で `PageHandler` を返す。

```typescript
import type { PageHandler } from "../../framework";

const HelloPage: PageHandler = (ctx) => (
  <h1>Hello, {ctx.params["name"]}!</h1>
);

export default HelloPage;
```

- `PageHandler` 型: `(ctx: Context) => RainElement | Promise<RainElement>`
- ページは常に GET メソッドとして登録される
- レイアウトが自動適用され、`<!DOCTYPE html>` はルートレイアウト存在時に自動付与される
- 同一ディレクトリに `route.ts` が存在する場合はビルドエラー

## レイアウトファイルの書き方

`layout.tsx` を配置すると、そのディレクトリ以下の全 `page.tsx` にレイアウトが自動適用される。

```typescript
import type { LayoutHandler } from "../framework";
import type { RainElement } from "../framework";

const RootLayout: LayoutHandler = (ctx, children: RainElement) => (
  <html lang="ja">
    <head>
      <meta charset="UTF-8" />
      <title>My App</title>
    </head>
    <body>{children}</body>
  </html>
);

export default RootLayout;
```

- `LayoutHandler` 型: `(ctx: Context, children: RainElement) => RainElement | Promise<RainElement>`
- default export で `LayoutHandler` を返す（必須）
- ネスト可能（親→子の順に適用される）
- ルートレイアウト（`src/routes/layout.tsx`）が存在する場合、`<!DOCTYPE html>` が自動付与される
- `route.ts`（API エンドポイント）にはレイアウトは適用されない

## コマンド一覧

| コマンド            | 説明                                              |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | 開発サーバー起動（ルート自動生成 + wrangler dev） |
| `npm run lint`      | Biome によるリント                                |
| `npm run format`    | Biome によるフォーマット                          |
| `npm run check`     | Biome のリント + フォーマット一括修正             |
| `npm run typecheck` | TypeScript 型チェック                             |
| `npm run ci`        | CI 用チェック（Biome CI + 型チェック）            |

## 設計ドキュメント

設計書は Notion で管理しています。新機能の設計や仕様の確認が必要な場合は、Notion MCP を使用して以下のページを参照してください。

### 最優先ドキュメント

- **APIリファレンス**: https://www.notion.so/discope/API-32b9cc5a1062809eb095c63ad44ff826
  - template / Routing / Request・Response オブジェクト / Middleware
- **機能仕様**: https://www.notion.so/discope/32b9cc5a106280d4b2eae62df8f55085
  - HTTPサーバーコア / template / ルーターアルゴリズム / DI・コンテキスト管理

### プロジェクト・コンセプト

- **プロジェクト・コンセプト**: https://www.notion.so/discope/32b9cc5a1062802fbdf9fe4db2820373
  - **設計理念**: https://www.notion.so/discope/32b9cc5a106280079c33ec533e998014
  - **技術スタック**: https://www.notion.so/discope/32b9cc5a106280ca8153c02379b1692b
  - **アーキテクチャ概要**: https://www.notion.so/discope/32b9cc5a106280ce9fa3c3e824eafdec

設計に関する作業を行う際は：

- **実装前に必ず Notion の APIリファレンス・機能仕様を確認し、設計意図に沿ったコードを書くこと**
- 新しい設計判断が必要な場合は Notion に記録すること
- 設計理念（上記5原則）に反する変更は行わないこと
